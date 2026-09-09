// Original deterministic documents for local extraction and queue checks.
// Offsets are UTF-16 units. These values are fixture expectations, not results.
export const EXTRACTION_SLICE_LENGTH=4000;
const segments=[
  ['【记忆点 A】林汐负责维护灯塔，每晚核对灯室的温度。','【记忆点 B】蓝色钥匙位于北侧柜子的第二层。'],
  ['【记忆点 C】乔岚负责航道记录，每天清晨检查南侧浮标。','【记忆点 D】备用透镜装在仓库的白色木箱中。'],
  ['【记忆点 E】顾棠保管维修手册，手册不得带离灯塔。','【记忆点 F】遇到大雾时应先鸣笛，再记录可见距离。'],
  ['【记忆点 G】温榆负责检查蓄电池，每周三登记电压。','【记忆点 H】红色工具袋放在西侧工作台下方。'],
  ['【记忆点 I】沈砚保管船只登记簿，登记簿存放在二楼书架。','【记忆点 J】发现灯罩裂纹时应暂停照明，并通知维修员。']
];
function documentText(count,lastLength){
  return segments.slice(0,count).map((lines,index)=>{
    const intro=`原创软件验收文档，第 ${index+1} 片。\n${lines.join('\n')}\n`;
    const padding=Array.from({length:100},(_,i)=>`记录 ${index+1}-${String(i).padStart(3,'0')}：这是一段只用于填充长文长度的原创说明，检查片段边界和引用坐标。\n`).join('');
    return (intro+padding).slice(0,index===count-1?lastLength-1:EXTRACTION_SLICE_LENGTH-1)+'\n';
  }).join('');
}
const fixture=(key,libraryName,sourceName,taskName,count,lastLength)=>Object.freeze({
  key,libraryName,sourceName,taskName,text:documentText(count,lastLength),
  expectedSlices:count,expectedCandidates:count*2,
  expectedRanges:Object.freeze(Array.from({length:count},(_,index)=>Object.freeze([index*EXTRACTION_SLICE_LENGTH,index===count-1?(count-1)*EXTRACTION_SLICE_LENGTH+lastLength:(index+1)*EXTRACTION_SLICE_LENGTH])))
});
export const EXTRACTION_FIXTURES=Object.freeze({
  original:fixture('original','原文提炼验收','原创灯塔提炼文档','灯塔文档提炼',3,1301),
  queue:fixture('queue','提炼队列验收','原创五片灯塔队列文档','灯塔五片提炼队列',5,1001)
});
