import {installSoftBody} from './client.js';
document.body.classList.add('soft-enabled');
const client=installSoftBody();
// Read-only diagnostics are kept on the extension page, never exported to sites.
globalThis.__textMemorySoftBodyDiagnostics=client?{snapshot:client.getSnapshot,timings:client.getTimings,geometry:client.getBodyFrame}:null;
