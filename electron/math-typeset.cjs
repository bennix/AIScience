const COMMANDS=new Set(('frac dfrac tfrac sqrt sum prod int iint iiint oint lim log ln exp sin cos tan sinh cosh tanh arcsin arccos arctan min max inf sup det gcd mod bmod pmod binom dbinom tbinom vec hat bar overline underline dot ddot tilde widehat widetilde mathrm mathbf mathit mathsf mathbb mathcal text operatorname left right big Big bigg Bigg le leq ge geq ne neq approx sim simeq equiv propto in notin subset subseteq supset supseteq cup cap setminus emptyset varnothing forall exists neg land lor implies iff to mapsto rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow times cdot div pm mp circ oplus otimes partial nabla infty ell hbar degree angle perp parallel mid vert Vert lvert rvert lVert rVert langle rangle lceil rceil lfloor rfloor quad qquad ldots cdots vdots ddots alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega').split(' '));
function checkedMath(value){
  if(value.length>8000||value.includes('^^')||/[#$%&~\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw new Error('公式含不支持的 TeX 字符，请使用受支持的数学表达式');
  let depth=0;
  const plain=value.replace(/\\([A-Za-z]+|[ ,;!{}|])/g,(token,name)=>{if(name.length>1&&!COMMANDS.has(name))throw new Error(`公式命令不受支持：${token}`);if(name.length===1&&/[A-Za-z]/.test(name)&&!COMMANDS.has(name))throw new Error(`公式命令不受支持：${token}`);return '';});
  if(plain.includes('\\'))throw new Error('公式含不支持的反斜杠结构');
  for(const c of plain){if(c==='{')depth++;if(c==='}')depth--;if(depth<0||depth>30)throw new Error('公式花括号不匹配或嵌套过深');}if(depth)throw new Error('公式花括号不匹配');
  return value;
}
function typesetContent(content,escape){
  const text=value=>value.split('\n').map(line=>{const h=line.match(/^(#{1,3})\s+(.+)/);return h?`\\${h[1].length===1?'section':h[1].length===2?'subsection':'subsubsection'}{${escape(h[2])}}`:escape(line)+'\n';}).join('\n');
  let result='',last=0;const pattern=/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g;for(const m of content.matchAll(pattern)){result+=text(content.slice(last,m.index));result+=m[1]!==undefined?`\\[${checkedMath(m[1])}\\]`:`\\(${checkedMath(m[2])}\\)`;last=m.index+m[0].length;}return result+text(content.slice(last));
}
module.exports={checkedMath,typesetContent};
