import{a as e,i as t,n}from"./ErrorBoundary.js";import{u as r}from"./api.js";var i=e(t(),1),a=n(),o=`
  .vo-content {
    line-height: 1.8;
    font-size: 16px;
  }
  .vo-content h1 {
    font-size: 32px;
    margin-bottom: 20px;
    font-weight: 800;
  }
  .vo-content h2 {
    font-size: 24px;
    margin-top: 30px;
    margin-bottom: 15px;
    font-weight: 700;
  }
  .vo-content h3 {
    font-size: 20px;
    margin-top: 25px;
    margin-bottom: 12px;
    font-weight: 600;
  }
  .vo-content p {
    margin-bottom: 15px;
  }
  .vo-content strong {
    font-weight: 700;
    color: #1db954;
  }
  .vo-content em {
    font-style: italic;
    color: #b2b2b8;
  }
  .vo-content a {
    color: #3498db;
    text-decoration: none;
  }
  .vo-content a:hover {
    text-decoration: underline;
  }
  .vo-content img {
    max-width: 100%;
    border-radius: 10px;
    margin: 20px 0;
  }
  .vo-content ul, .vo-content ol {
    margin-left: 20px;
    margin-bottom: 15px;
  }
  .vo-content li {
    margin-bottom: 8px;
  }
  .vo-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    overflow: hidden;
  }
  .vo-content table th {
    background: rgba(255,255,255,0.05);
    padding: 12px 16px;
    text-align: left;
    font-weight: 700;
    border-bottom: 2px solid rgba(255,255,255,0.12);
    color: #1db954;
  }
  .vo-content table td {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .vo-content table tr:last-child td {
    border-bottom: none;
  }
  .media-section {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 20px;
    margin-top: 30px;
  }
  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 15px;
    margin-top: 15px;
  }
  .media-item {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    overflow: hidden;
  }
  .media-item img, .media-item video {
    width: 100%;
    display: block;
  }
  .media-item-title {
    padding: 10px;
    font-size: 13px;
    color: #b2b2b8;
  }
`;function s(e){if(!e||typeof e!=`string`)return``;let t=e;return t=t.replace(/\|(.+)\|\n\|[\s:|-]+\|\n((?:\|.+\|\n?)*)/gm,e=>{let t=e.trim().split(`
`).filter(e=>e.trim());if(t.length<2)return e;let n=t[0].split(`|`).map(e=>e.trim()).filter(e=>e!==``);if(n.length===0)return e;let r=`<table style="width:100%; border-collapse:collapse; margin:20px 0;"><thead><tr style="background-color:#2ecc71;">`;n.forEach(e=>{r+=`<th style="padding:12px; text-align:center; border:1px solid #444; font-weight:bold; color:#000;">${e}</th>`}),r+=`</tr></thead><tbody>`;for(let e=2;e<t.length;e++){let n=t[e];if(n.includes(`|`)){let e=n.split(`|`).map(e=>e.trim()).filter(e=>e!==``);e.length>0&&(r+=`<tr>`,e.forEach(e=>{r+=`<td style="padding:10px; text-align:center; border:1px solid #444; color:#f1f1f1;">${e}</td>`}),r+=`</tr>`)}}return r+=`</tbody></table>`,r}),t=t.replace(/^### (.*$)/gim,`<h3>$1</h3>`).replace(/^## (.*$)/gim,`<h2>$1</h2>`).replace(/^# (.*$)/gim,`<h1>$1</h1>`).replace(/\*\*(.*?)\*\*/gim,`<strong>$1</strong>`).replace(/\*(.*?)\*/gim,`<em>$1</em>`).replace(/!\[(.*?)\]\((.*?)\)/gim,`<img alt="$1" src="$2" />`).replace(/\[(.*?)\]\((.*?)\)/gim,`<a href="$2">$1</a>`).replace(/\n/gim,`<br />`),t}function c(){let[e,t]=(0,i.useState)(``),[n,c]=(0,i.useState)({zip:null,images:[],videos:[]}),[l,u]=(0,i.useState)(!0);return(0,i.useEffect)(()=>{(async()=>{try{let e=await r(),n=e.content||e;t(n.markdown||n.html||``),c({zip:n.assets?.zip||null,images:Array.isArray(n.assets?.images)?n.assets.images:[],videos:Array.isArray(n.assets?.videos)?n.assets.videos:[]})}catch(e){console.error(`Failed to load content:`,e)}finally{u(!1)}})()},[]),(0,a.jsxs)(`div`,{style:{minHeight:`100vh`,background:`#0d0d12`,color:`#fff`},children:[(0,a.jsx)(`style`,{children:o}),(0,a.jsx)(`main`,{style:{maxWidth:`900px`,margin:`0 auto`,padding:`60px 20px`},children:l?(0,a.jsx)(`div`,{style:{textAlign:`center`,color:`#7a7a82`},children:`Loading...`}):(0,a.jsxs)(a.Fragment,{children:[(0,a.jsx)(`div`,{className:`vo-content`,dangerouslySetInnerHTML:{__html:s(e)||`<p style="color:#7a7a82">No content available yet.</p>`}}),n.zip&&(0,a.jsxs)(`div`,{className:`media-section`,children:[(0,a.jsx)(`h3`,{style:{margin:0,marginBottom:`15px`},children:`📦 Download Pack`}),(0,a.jsxs)(`div`,{style:{background:`rgba(29, 185, 84, 0.1)`,border:`1px solid rgba(29, 185, 84, 0.3)`,borderRadius:`10px`,padding:`15px`,display:`flex`,justifyContent:`space-between`,alignItems:`center`},children:[(0,a.jsxs)(`div`,{children:[(0,a.jsx)(`div`,{style:{fontWeight:600},children:n.zip.name}),(0,a.jsxs)(`div`,{style:{fontSize:`12px`,color:`#b2b2b8`,marginTop:`4px`},children:[(n.zip.size/1024/1024).toFixed(2),` MB`]})]}),(0,a.jsx)(`a`,{href:`/vo/uploads/${n.zip.name}`,download:!0,style:{background:`linear-gradient(90deg, #1db954, #1ed760)`,border:`none`,color:`#000`,padding:`10px 16px`,borderRadius:`10px`,fontWeight:700,cursor:`pointer`,textDecoration:`none`,display:`inline-block`},children:`Download`})]})]}),n.images&&n.images.length>0&&(0,a.jsxs)(`div`,{className:`media-section`,children:[(0,a.jsx)(`h3`,{style:{margin:0,marginBottom:`15px`},children:`🖼️ Images`}),(0,a.jsx)(`div`,{className:`media-grid`,children:n.images.map((e,t)=>(0,a.jsxs)(`div`,{className:`media-item`,children:[(0,a.jsx)(`img`,{src:`/vo/uploads/${e.name}`,alt:e.name}),(0,a.jsx)(`div`,{className:`media-item-title`,children:e.name})]},e.id||t))})]}),n.videos&&n.videos.length>0&&(0,a.jsxs)(`div`,{className:`media-section`,children:[(0,a.jsx)(`h3`,{style:{margin:0,marginBottom:`15px`},children:`🎥 Videos`}),(0,a.jsx)(`div`,{className:`media-grid`,children:n.videos.map((e,t)=>(0,a.jsxs)(`div`,{className:`media-item`,children:[(0,a.jsx)(`video`,{controls:!0,src:`/vo/uploads/${e.name}`}),(0,a.jsx)(`div`,{className:`media-item-title`,children:e.name})]},e.id||t))})]})]})})]})}export{c as t};