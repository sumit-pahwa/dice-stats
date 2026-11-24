import { makeStore } from '../lib/store.js';
import { blobAdapter } from '../lib/blob-adapter.js';
import { measurementsHandler } from '../lib/handlers.js';

export default measurementsHandler(makeStore(blobAdapter));
