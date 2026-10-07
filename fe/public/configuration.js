export const configuration=await fetch('/api/configuration').then(async r=>{if(!r.ok)throw new Error('Public configuration unavailable');const data=await r.json();if(data.version!==1||!data.copy||!data.limits)throw new Error('Unsupported configuration');return data;});
export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function textCopy(key){if(!Object.hasOwn(configuration.copy,key))throw new Error('Missing UI content: '+key);return configuration.copy[key];}
// Safe by default for the template-based UI. Plain DOM/canvas consumers use textCopy.
export const t=key=>escapeText(textCopy(key));
export function htmlCopy(markup){return markup.replace(/\{\{copy:([a-z0-9_]+)\}\}/g,(match,key)=>Object.hasOwn(configuration.copy,key)?t(key):match);}
export function hydrateCopy(root=document.body){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes)if(!['SCRIPT','STYLE','TEXTAREA'].includes(node.parentElement?.tagName)&&node.nodeValue.includes('{{copy:'))node.nodeValue=node.nodeValue.replace(/\{\{copy:([a-z0-9_]+)\}\}/g,(_,key)=>textCopy(key));
 for(const el of root.querySelectorAll('*'))for(const key of ['title','placeholder','aria-label','alt'])if(el.hasAttribute(key))el.setAttribute(key,el.getAttribute(key).replace(/\{\{copy:([a-z0-9_]+)\}\}/g,(_,id)=>textCopy(id)));
}
hydrateCopy();
