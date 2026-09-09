import './bridge.js';
// Explicit standalone fault injection. Never shipped in the extension.
// Leave the local frame mounted without sending ready, so the host's timeout
// and same-instance cleanup can be observed in a real browser.
if (window.top.document.querySelector('#blockFloatingBoot')?.checked) {
  document.querySelector('#status').textContent = '本地故障模拟：跳过浮窗初始化，等待测试宿主超时清理。';
} else {
  await import('../product/floating.js');
}
