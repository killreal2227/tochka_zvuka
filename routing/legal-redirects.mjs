/* Dedicated legal routes; the lead/Telegram Worker is never changed. */
const sections={privacy:'privacy',consent:'consent',details:'details',requisites:'details'};
export function legalRedirect(request){
 const url=new URL(request.url);
 const match=url.pathname.match(/^\/(privacy|consent|details|requisites)(?:\/(?:index\.html)?|\.html)?$/);
 if(!match)return null;
 const target=new URL('/documents/',url.origin);
 target.search=url.search;target.hash=sections[match[1]];
 return new Response(null,{status:301,headers:{Location:target.href,'Cache-Control':'public, max-age=3600'}});
}
export default {fetch(request){return legalRedirect(request)||fetch(request);}};
