var Q = require("q");

function start(config, onServerReady) {
  var express = require('express');
  var cookieSession = require('cookie-session');
  var cookieParser = require('cookie-parser');
  var csrf = require('csurf');
  var googleAuth = require('./google-auth.js');
  var request = require('request');
  var url = require('url');
//  var mail = require('./mail.js');
  var fs = require('fs');

  function requireLogin(req, res) {
    var login = Q.defer();
    var session = req.session;
    function redirect() {
      res.redirect("/login?redirect=" + encodeURIComponent(req.originalUrl));
    }
    if(!session || !session["user_id"]) {
      console.log("Redirecting, no user id in session", JSON.stringify(session));
      redirect();
    }
    else {
      var maybeUser = db.getUserByGoogleId(req.session["user_id"]);
      maybeUser.then(function(u) {
        login.resolve(u);
      });
    }
    return login.promise;
  }

  app = express();

  // This has to go first to override other options
  app.get("/js/pyret.js", function(req, res) {
    res.set("Content-Encoding", "gzip");
    res.set("Content-Type", "application/javascript");
    res.send(fs.readFileSync("build/web/js/pyret.js.gz"));
  });

  app.use(express.static(__dirname + "/../build/web/"));

  app.use(cookieSession({
    secret: config.sessionSecret,
    key: "code.pyret.org"
  }));
  app.use(cookieParser());
  app.use(csrf());

  var auth = googleAuth.makeAuth(config);
  var db = config.db;

  app.get("/", function(req, res) {
    res.sendfile("build/web/index.html");
  });

  app.get("/login", function(req, res) {
    var redirect = req.param("redirect") || "/my-programs";
    if(!(req.session && req.session["user_id"])) {
      res.redirect(auth.getAuthUrl(redirect));
    }
    else {
      res.redirect(redirect);
    }
  });

  app.get("/download", function(req, response) {
    var parsed = url.parse(req.url);
    var googleLink = decodeURIComponent(parsed.query.slice(0));
    var googleParsed = url.parse(googleLink);
    console.log(googleParsed);
    var gReq = request(googleLink);
    gReq.pipe(response);
  });

  app.get(config.google.redirect, function(req, res) {
    auth.serveRedirect(req, function(err, data) {
      console.log("Data was: ", data);
      if(err) { res.send({type: "auth error", error: err}); }
      else {
        console.log("Redirect returned data: ", data);
        var existingUser = db.getUserByGoogleId(data.googleId);
        existingUser.fail(function(err) {
          console.log("Error on getting user: ", err);
          res.send({type: "DB error", error: err});
        });
        var user = existingUser.then(function(user) {
          console.log("Existing user: ", typeof user, JSON.stringify(user));
          if(user === null) {
            var newUser = db.createUser({
              google_id: data.googleId,
              refresh_token: data.refresh
            });
            return newUser;
          }
          else {
            var thisUser = user;
            // The refresh token is present if the old one expired; we should
            // always use the most up-to-date token we've received from Google
            // TODO(joe): cache invalidation here
            if(data.refresh) {
              var updated = db.updateRefreshToken(user.google_id, data.refresh);
              thisUser = updated.then(function(_) {
                return db.getUserByGoogleId(data.googleId);
              });
            } else {
              thisUser = Q.fcall(function() { return user; });
            }
            return thisUser;
          }
        });
        user.then(function(u) {
          const redirect = req.param("state") || "/my-programs"; 
          console.log(JSON.stringify(u));
          req.session["user_id"] = u.google_id;
          console.log("Redirecting after successful login", JSON.stringify(req.session));
          res.redirect(redirect);
        });
        user.fail(function(err) {
          console.error("Authentication failure", err, err.stack);
          res.redirect("/authError");
        });
      }
    });
  });

  app.get("/getAccessToken", function(req, res) {
    console.log(JSON.stringify(req.session));
    function noAuth() {
      res.status(404).send("No account information found.");
    }
    if(req.session && req.session["user_id"]) {
      var maybeUser = db.getUserByGoogleId(req.session["user_id"]);
      maybeUser.then(function(u) {
        if(u === null) {
          noAuth();
          return null;
        }
        return auth.refreshAccess(u.refresh_token, function(err, newToken) {
          if(err) { res.send(err); res.end(); return; }
          else {
            res.send({ access_token: newToken });
            res.end();
          }
        });
      });
      maybeUser.fail(function(err) {
        console.log("Failed to get an access token: ", err);
        noAuth();
      });
    } else {
      noAuth();
    }
  });

  app.get("/share", function(req, res) {

  });

  app.get("/editor", function(req, res) {
    res.sendfile("build/web/repl.html");
  });

  app.get("/my-programs", function(req, res) {
    var u = requireLogin(req, res);
    u.then(function(user) {
      console.log("Responding");
      res.sendfile("build/web/my-programs.html");
    });
  });

  app.get("/api-test", function(req, res) {
    res.sendfile("build/web/api-play.html");
  });

  app.get("/logout", function(req, res) {
    req.session = null;
    delete req.session;
    res.redirect("/");
  });

  var server = app.listen(config["port"]);

  onServerReady(app, server);

}

module.exports = {
  start: start
};