import{a as e,i as t,n}from"./ErrorBoundary.js";import{S as r,b as i,u as a}from"./api.js";var o=e(t(),1),s=n(),c=`
  .md-editor-container {
    background-color: #1e1e1e;
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 30px;
  }
  .md-textarea {
    width: 100%;
    min-height: 400px;
    background: #2c2c2c;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 15px;
    color: #f1f1f1;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 14px;
    line-height: 1.6;
    resize: vertical;
  }
  .md-textarea:focus {
    outline: none;
    border-color: #3498db;
  }
  .md-preview {
    background: #2c2c2c;
    border: 1px solid #444;
    padding: 15px;
    border-radius: 6px;
    color: #f1f1f1;
    min-height: 400px;
    line-height: 1.6;
  }
  .md-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .md-status {
    font-size: 0.9em;
    color: #bbb;
    margin-left: 15px;
  }
  .md-count {
    font-size: 0.9em;
    color: #bbb;
    margin-left: 15px;
  }
  .asset-upload-section {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 15px;
    margin-top: 20px;
  }
  .upload-box {
    background: #2c2c2c;
    border: 2px dashed #444;
    border-radius: 6px;
    padding: 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  .upload-box:hover {
    border-color: #3498db;
    background: #333;
  }
  .upload-box input {
    display: none;
  }
  .asset-list {
    margin-top: 10px;
    font-size: 12px;
    color: #aaa;
  }
  .asset-item {
    background: #222;
    padding: 5px 8px;
    border-radius: 4px;
    margin-top: 5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .asset-item button {
    background: #d9534f;
    border: none;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }
  .progress-bar {
    width: 100%;
    height: 8px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 8px;
  }
  .progress-fill {
    height: 100%;
    width: 0%;
    background: #3498db;
    transition: width 0.2s ease;
  }
  .progress-text {
    font-size: 11px;
    color: #aaa;
    margin-top: 4px;
    text-align: right;
  }
`;function l(){let[e,t]=(0,o.useState)(``),[n,l]=(0,o.useState)(!1),[u,d]=(0,o.useState)(`Saved`),[f,p]=(0,o.useState)(0),[m,h]=(0,o.useState)(0),[g,_]=(0,o.useState)({zip:null,images:[],videos:[]}),[v,y]=(0,o.useState)({save:0,zip:0,image:0,video:0}),b=(0,o.useRef)(null),x=(0,o.useRef)(``);(0,o.useEffect)(()=>{(async()=>{try{let e=await a(),n=e.content||e,r=n.markdown||n.html||``,i={zip:n.assets?.zip||null,images:Array.isArray(n.assets?.images)?n.assets.images:[],videos:Array.isArray(n.assets?.videos)?n.assets.videos:[]};t(r),_(i),x.current=r}catch(e){console.error(`Failed to load content:`,e)}})()},[]),(0,o.useEffect)(()=>{let t=e.trim(),n=t.split(/\s+/).filter(Boolean).length,r=t.length;return p(n),h(r),e!==x.current&&(d(`Unsaved`),b.current&&clearTimeout(b.current),b.current=setTimeout(async()=>{try{d(`Saving...`),await i({markdown:e,assets:g},(e,t)=>{let n=t?Math.round(e/t*100):e?100:0;y(e=>({...e,save:n}))}),d(`Saved`),y(e=>({...e,save:0})),x.current=e}catch(e){d(`Error`),console.error(`Autosave failed:`,e)}},3e3)),()=>{b.current&&clearTimeout(b.current)}},[e,g]);let S=async()=>{try{d(`Saving...`),await i({markdown:e,assets:g},(e,t)=>{let n=t?Math.round(e/t*100):e?100:0;y(e=>({...e,save:n}))}),d(`Saved`),y(e=>({...e,save:0})),x.current=e}catch(e){d(`Error`),console.error(`Save failed:`,e)}},C=async(e,t)=>{if(!(!t||t.length===0))try{if(e===`zip`){let e=t[0];d(`Uploading...`);let n=await r(e,(e,t)=>{let n=t?Math.round(e/t*100):e?100:0;y(e=>({...e,zip:n}))});_(e=>({...e,zip:n})),y(e=>({...e,zip:0})),d(`Saved`)}else if(e===`image`||e===`video`){d(`Uploading...`);let n=e===`image`?`images`:`videos`,i=e===`image`?`image`:`video`,a=[],o=Array.from(t);for(let e=0;e<o.length;e++){let t=o[e],n=await r(t,(t,n)=>{let r=n?t/n*100:t?100:0,a=Math.round((e+r/100)/o.length*100);y(e=>({...e,[i]:a}))});a.push(n)}_(e=>({...e,[n]:[...e[n]||[],...a]})),y(e=>({...e,[i]:0})),d(`Saved`)}}catch(e){d(`Upload failed`),console.error(`Upload error:`,e)}},w=(e,t)=>{e===`zip`?_(e=>({...e,zip:null})):e===`image`?_(e=>({...e,images:e.images.filter((e,n)=>n!==t)})):e===`video`&&_(e=>({...e,videos:e.videos.filter((e,n)=>n!==t)}))};return(0,s.jsxs)(`div`,{style:{minHeight:`100vh`,background:`#121212`,color:`#eee`,padding:`20px`,fontFamily:`'Segoe UI', sans-serif`},children:[(0,s.jsx)(`style`,{children:c}),(0,s.jsx)(`h1`,{style:{marginBottom:`30px`},children:`Admin: Edit Community VO Content`}),(0,s.jsxs)(`div`,{className:`md-editor-container`,children:[(0,s.jsxs)(`div`,{className:`md-toolbar`,children:[(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`h2`,{style:{display:`inline-block`,margin:0},children:`Markdown Editor`}),(0,s.jsx)(`span`,{className:`md-status`,children:u}),(0,s.jsxs)(`span`,{className:`md-count`,children:[f,` words, `,m,` chars`]})]}),(0,s.jsxs)(`div`,{style:{display:`flex`,gap:`10px`},children:[(0,s.jsx)(`button`,{onClick:()=>{t(e+`| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
| Data | Data | Data |
| Data | Data | Data |

`)},style:{background:`#2ecc71`,color:`white`,border:`none`,padding:`5px 10px`,borderRadius:`4px`,cursor:`pointer`,fontSize:`14px`},onMouseOver:e=>e.target.style.background=`#27ae60`,onMouseOut:e=>e.target.style.background=`#2ecc71`,children:`📊 Insert Table`}),(0,s.jsx)(`button`,{onClick:()=>l(!n),style:{background:`#555`,color:`white`,border:`none`,padding:`5px 10px`,borderRadius:`4px`,cursor:`pointer`},onMouseOver:e=>e.target.style.background=`#777`,onMouseOut:e=>e.target.style.background=`#555`,children:n?`Edit`:`Preview`})]})]}),n?(0,s.jsx)(`div`,{className:`md-preview`,dangerouslySetInnerHTML:{__html:(e=>e.replace(/^### (.*$)/gim,`<h3>$1</h3>`).replace(/^## (.*$)/gim,`<h2>$1</h2>`).replace(/^# (.*$)/gim,`<h1>$1</h1>`).replace(/\*\*(.*)\*\*/gim,`<strong>$1</strong>`).replace(/\*(.*)\*/gim,`<em>$1</em>`).replace(/!\[(.*?)\]\((.*?)\)/gim,`<img alt="$1" src="$2" />`).replace(/\[(.*?)\]\((.*?)\)/gim,`<a href="$2">$1</a>`).replace(/\n/gim,`<br />`))(e)}}):(0,s.jsx)(`textarea`,{className:`md-textarea`,value:e,onChange:e=>t(e.target.value),placeholder:`# Community VO Hub

Write your content in **Markdown**...

## Example:
- Use **bold** with **text**
- Use *italic* with *text*
- Add images: ![alt](url)
- Add links: [text](url)`}),v.save>0&&(0,s.jsxs)(`div`,{style:{marginTop:`8px`},children:[(0,s.jsx)(`div`,{className:`progress-bar`,children:(0,s.jsx)(`div`,{className:`progress-fill`,style:{width:`${v.save}%`,background:`#3498db`}})}),(0,s.jsxs)(`div`,{className:`progress-text`,children:[`Saving... `,v.save,`%`]})]}),(0,s.jsxs)(`div`,{className:`asset-upload-section`,children:[(0,s.jsxs)(`div`,{className:`upload-box`,children:[(0,s.jsxs)(`label`,{style:{cursor:`pointer`,display:`block`},children:[(0,s.jsx)(`div`,{style:{fontSize:`40px`},children:`📦`}),(0,s.jsx)(`div`,{style:{fontWeight:600,marginTop:`10px`},children:`Upload ZIP`}),(0,s.jsx)(`div`,{style:{fontSize:`12px`,color:`#888`,marginTop:`5px`},children:g.zip?g.zip.name:`Click to upload`}),(0,s.jsx)(`input`,{type:`file`,accept:`.zip`,onChange:e=>C(`zip`,e.target.files)})]}),v.zip>0&&(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`div`,{className:`progress-bar`,children:(0,s.jsx)(`div`,{className:`progress-fill`,style:{width:`${v.zip}%`,background:`#2ecc71`}})}),(0,s.jsxs)(`div`,{className:`progress-text`,children:[`Uploading ZIP... `,v.zip,`%`]})]}),g.zip&&(0,s.jsx)(`div`,{className:`asset-list`,children:(0,s.jsxs)(`div`,{className:`asset-item`,children:[(0,s.jsx)(`span`,{children:g.zip.name}),(0,s.jsx)(`button`,{onClick:()=>w(`zip`),children:`×`})]})})]}),(0,s.jsxs)(`div`,{className:`upload-box`,children:[(0,s.jsxs)(`label`,{style:{cursor:`pointer`,display:`block`},children:[(0,s.jsx)(`div`,{style:{fontSize:`40px`},children:`🖼️`}),(0,s.jsx)(`div`,{style:{fontWeight:600,marginTop:`10px`},children:`Upload Images`}),(0,s.jsxs)(`div`,{style:{fontSize:`12px`,color:`#888`,marginTop:`5px`},children:[(g.images||[]).length,` uploaded`]}),(0,s.jsx)(`input`,{type:`file`,accept:`image/*`,multiple:!0,onChange:e=>C(`image`,e.target.files)})]}),v.image>0&&(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`div`,{className:`progress-bar`,children:(0,s.jsx)(`div`,{className:`progress-fill`,style:{width:`${v.image}%`,background:`#2ecc71`}})}),(0,s.jsxs)(`div`,{className:`progress-text`,children:[`Uploading Images... `,v.image,`%`]})]}),(g.images||[]).length>0&&(0,s.jsx)(`div`,{className:`asset-list`,children:(g.images||[]).map((e,t)=>(0,s.jsxs)(`div`,{className:`asset-item`,children:[(0,s.jsx)(`span`,{children:e.name}),(0,s.jsx)(`button`,{onClick:()=>w(`image`,t),children:`×`})]},e.id))})]}),(0,s.jsxs)(`div`,{className:`upload-box`,children:[(0,s.jsxs)(`label`,{style:{cursor:`pointer`,display:`block`},children:[(0,s.jsx)(`div`,{style:{fontSize:`40px`},children:`🎥`}),(0,s.jsx)(`div`,{style:{fontWeight:600,marginTop:`10px`},children:`Upload Videos`}),(0,s.jsxs)(`div`,{style:{fontSize:`12px`,color:`#888`,marginTop:`5px`},children:[(g.videos||[]).length,` uploaded`]}),(0,s.jsx)(`input`,{type:`file`,accept:`video/*`,multiple:!0,onChange:e=>C(`video`,e.target.files)})]}),v.video>0&&(0,s.jsxs)(`div`,{children:[(0,s.jsx)(`div`,{className:`progress-bar`,children:(0,s.jsx)(`div`,{className:`progress-fill`,style:{width:`${v.video}%`,background:`#2ecc71`}})}),(0,s.jsxs)(`div`,{className:`progress-text`,children:[`Uploading Videos... `,v.video,`%`]})]}),(g.videos||[]).length>0&&(0,s.jsx)(`div`,{className:`asset-list`,children:(g.videos||[]).map((e,t)=>(0,s.jsxs)(`div`,{className:`asset-item`,children:[(0,s.jsx)(`span`,{children:e.name}),(0,s.jsx)(`button`,{onClick:()=>w(`video`,t),children:`×`})]},e.id))})]})]}),(0,s.jsx)(`button`,{onClick:S,style:{backgroundColor:`#3498db`,color:`white`,padding:`10px 18px`,border:`none`,borderRadius:`5px`,fontSize:`16px`,cursor:`pointer`,marginTop:`20px`},onMouseOver:e=>e.target.style.backgroundColor=`#2980b9`,onMouseOut:e=>e.target.style.backgroundColor=`#3498db`,children:`Save Content`})]})]})}export{l as t};