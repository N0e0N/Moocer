import assert from "node:assert/strict";

const spokenChars=text=>(text.match(/[\u3400-\u9fffA-Za-z0-9]/g)||[]).length;
const MIN_SEGMENT_CHARS=17,MAX_SEGMENT_CHARS=72;
function mergeShortSegments(segments){const merged=[];let current="";for(const segment of segments){current+=segment;if(spokenChars(current)>=MIN_SEGMENT_CHARS){merged.push(current);current=""}}if(current){const previous=merged.at(-1);if(previous&&spokenChars(previous)+spokenChars(current)<=MAX_SEGMENT_CHARS)merged[merged.length-1]=previous+current;else merged.push(current)}return merged}
function splitSegments(text){const sentences=text.match(/[^。！？；]+[。！？；]?/g)||[text];return sentences.flatMap(sentence=>spokenChars(sentence)/4.8<=16?[sentence]:mergeShortSegments((sentence.match(/[^，、：]+[，、：]?/g)||[sentence]).filter(Boolean))).filter(Boolean)}

const narration="我们现在进入生成艺术这条支线，它的核心问题非常直接：美要如何被算法生成？你看页面里的发源说明，它其实就是我们上节课提到的百年图谱里Whitney用参数方程生成视觉的思路，在数字时代的直接延伸。而设计师的角色在这里已经完全变了：你不再需要逐像素画完所有画面，而是去设计规则、调整参数，最后从大量涌现出来的结果里筛选出最好的那一个，你的判断力就体现在规则设计和结果选择这两个环节里。接下来我们会沿着三个阶段展开这条支线：从Flash草根时代，到Processing开源母语时代，再到今天的AI数据雕塑时代，整个演进的本质，其实就是生成规则的来源在不断升级。";
const segments=splitSegments(narration);
assert.ok(segments.every(segment=>spokenChars(segment)>=MIN_SEGMENT_CHARS),JSON.stringify(segments,null,2));
assert.ok(segments.every(segment=>!/^调整参数[，,]?$/.test(segment.trim())));
assert.equal(segments.join(""),narration);
console.log(JSON.stringify({segments:segments.length,minChars:Math.min(...segments.map(spokenChars)),preview:segments},null,2));
