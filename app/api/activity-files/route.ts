import { activityFiles } from '@/lib/activity-store';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request:Request){
  const auth=await authenticateRequest(request,'records:write');if(!auth.ok)return auth.response;
  const form=await request.formData(); const file=form.get('file');
  if(!(file instanceof File))return Response.json({error:'A file is required.'},{status:400});
  if(file.size>10*1024*1024)return Response.json({error:'Files must be 10 MB or smaller.'},{status:413});
  const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-'); const key=`activities/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  await activityFiles().put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{originalName:file.name}});
  return Response.json({key,name:file.name,url:`/api/activity-files?key=${encodeURIComponent(key)}`});
}

export async function GET(request:Request){
  const auth=await authenticateRequest(request);if(!auth.ok)return auth.response;
  const key=new URL(request.url).searchParams.get('key'); if(!key)return new Response('Missing file key',{status:400});
  const object=await activityFiles().get(key); if(!object)return new Response('File not found',{status:404});
  const headers=new Headers(); object.writeHttpMetadata(headers); headers.set('etag',object.httpEtag); headers.set('content-disposition',`inline; filename="${object.customMetadata?.originalName||'attachment'}"`);
  return new Response(object.body,{headers});
}

export async function DELETE(request:Request){
  const auth=await authenticateRequest(request,'records:write');if(!auth.ok)return auth.response;
  const key=new URL(request.url).searchParams.get('key');if(!key||!key.startsWith('activities/'))return Response.json({error:'A valid activity file key is required.'},{status:400});
  await activityFiles().delete(key);return Response.json({deleted:key});
}
