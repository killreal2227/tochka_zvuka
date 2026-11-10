import {handleRequest} from './relay-base.mjs';
import {handleLeads} from './leads.mjs';
export default {fetch(request,env){return new URL(request.url).pathname.startsWith('/leads')?handleLeads(request,env):handleRequest(request,env);}};
