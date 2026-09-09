export function trustedSender(sender,extensionId,extensionURL){
  // A full extension manager page may have sender.tab; side panels do not.
  // The browser-supplied sender URL, not tab presence, defines this boundary.
  return sender?.id===extensionId&&(sender.frameId===undefined||sender.frameId===0)
    &&(!sender.tab?.url||sender.tab.url.split('?')[0]===sender.url?.split('?')[0])
    &&['manager.html','sidepanel.html'].some(page=>sender.url?.split('?')[0]===extensionURL+page);
}
