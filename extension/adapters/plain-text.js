// Classic script loaded into the extension's isolated world before content.js.
// Only fixed wrapper markup is emitted; source text can never become an element.
globalThis.__textMemoryPlainTextHTML = text => '<span style="white-space:pre-wrap">'+
  text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</span>';
