const sourceSelect=document.getElementById('source-select'),sourceText=document.getElementById('source-text'),status=document.getElementById('source-status');
document.getElementById('load-source').addEventListener('click',async()=>{
  try{
    if(!['mobile-textarea.js','content.js','send-control.js','reply-reader.js'].includes(sourceSelect.value))throw Error('未知源码');
    const response=await fetch('../qa/production-adapters/'+sourceSelect.value,{cache:'no-store'});
    if(!response.ok)throw Error('读取失败 '+response.status);
    sourceText.value=await response.text();status.textContent='已读取 '+sourceSelect.value+'：'+sourceText.value.length+' 字符。';
  }catch(error){sourceText.value='';status.textContent=error.message;}
});
