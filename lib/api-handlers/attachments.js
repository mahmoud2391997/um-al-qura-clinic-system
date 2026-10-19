import {documentPaths,documentTargets,listDocuments,saveDocument} from '../documents.js';
export async function handleAttachments(context,phase){
const {path,method,body,db,user,permissions,auditedResponse,privateResponse}=context;
const documentPath=path.replace(/\/targets$/,'');
if(phase==='session'){
if (documentPaths.includes(documentPath)) {
      try {
        const actor = {
          ...user,
          permissions
        };
        if (method === 'GET') return privateResponse(path.endsWith('/targets') ? await documentTargets(db, documentPath, actor) : await listDocuments(db, documentPath, actor));
        if (path.endsWith('/targets')) return auditedResponse({
          error: 'للقراءة فقط'
        }, 403);
        return auditedResponse(await saveDocument(db, documentPath, body, actor));
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 400);
      }
    }
}
}
