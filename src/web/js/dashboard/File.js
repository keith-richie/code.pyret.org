import React, { Component } from 'react';

class File extends Component {
  render = () => {
    return (
        <div className='file-wrapper'>
          <div className="file" onClick={this.handleFileClick}>
            <img src='/img/pyret-logo.png'/>
            <span className='truncate'>{this.props.name}</span>
          </div>
        </div>
    );
  }

  handleFileClick = () => {
    window.open(EDITOR_REDIRECT_URL + this.props.id, '_blank');
  }
}

export default File;
