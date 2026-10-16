import {parse} from 'acorn';
export function routeInventory(source){
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),bindings=new Map(),paths=new Set(),prefixes=new Set();
 const walk=(node,visitor)=>{if(!node||typeof node!=='object')return;visitor(node);for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))for(const child of value)walk(child,visitor);else if(value&&typeof value==='object')walk(value,visitor)}};
 walk(tree,node=>{if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')bindings.set(node.id.name,node.init)});
 const resolved=node=>node?.type==='Identifier'?bindings.get(node.name)||node:node;
 const text=node=>resolved(node)?.type==='Literal'&&typeof resolved(node).value==='string'?resolved(node).value:null;
 walk(tree,node=>{
  if(node.type==='BinaryExpression'&&['===','==','!==','!='].includes(node.operator)){
   for(const [left,right]of [[node.left,node.right],[node.right,node.left]])if(left.type==='Identifier'&&['path','mod'].includes(left.name)&&text(right)!==null)paths.add(text(right));
  }
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'){
   const member=node.callee,method=member.property.name;
   if(member.object.type==='Identifier'&&member.object.name==='path'){
    if(method==='startsWith'&&text(node.arguments[0])!==null)prefixes.add(text(node.arguments[0]));
    else if(!['split','replace','endsWith'].includes(method))throw Error('Unreviewed path dispatch method: '+method);
   }
   if(method==='includes'&&node.arguments[0]?.type==='Identifier'&&node.arguments[0].name==='path'){
    const array=resolved(member.object);if(array?.type==='ArrayExpression'){for(const value of array.elements){if(text(value)===null)throw Error('Unreviewed dynamic route array');paths.add(text(value));}}
    else if(!['extraPaths'].includes(member.object.name))throw Error('Unreviewed route registry: '+member.object.name);
   }
  }
 });return {paths:[...paths].sort(),prefixes:[...prefixes].sort()};
}
