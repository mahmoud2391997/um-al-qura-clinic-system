// Booking values already represent Oman wall time: format without converting the time zone.
export function bookingDateLabel(value,language='ar'){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))return '';
 const date=new Date(value+'Z');if(!Number.isFinite(date.getTime()))return '';
 return new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-OM',{dateStyle:'long',timeStyle:'short',timeZone:'UTC'}).format(date);
}
