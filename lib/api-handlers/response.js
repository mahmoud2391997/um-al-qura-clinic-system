import {NextResponse} from 'next/server';
export const response=(payload,status=200)=>NextResponse.json(payload,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
