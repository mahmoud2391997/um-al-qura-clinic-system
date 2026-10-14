// Sequential iteration keeps database operations on the same transaction connection.
export async function asyncMap(rows,fn){const result=[];for(let i=0;i<rows.length;i++)result.push(await fn(rows[i],i,rows));return result;}
export async function asyncFilter(rows,fn){const result=[];for(let i=0;i<rows.length;i++)if(await fn(rows[i],i,rows))result.push(rows[i]);return result;}
export async function asyncEvery(rows,fn){for(let i=0;i<rows.length;i++)if(!await fn(rows[i],i,rows))return false;return true;}
export async function asyncSome(rows,fn){for(let i=0;i<rows.length;i++)if(await fn(rows[i],i,rows))return true;return false;}
export async function asyncFind(rows,fn){for(let i=0;i<rows.length;i++)if(await fn(rows[i],i,rows))return rows[i];}
export async function asyncReduce(rows,fn,initial){let result=initial;for(let i=0;i<rows.length;i++)result=await fn(result,rows[i],i,rows);return result;}
export async function asyncForEach(rows,fn){for(let i=0;i<rows.length;i++)await fn(rows[i],i,rows);}
