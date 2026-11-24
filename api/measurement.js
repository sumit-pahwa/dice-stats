import { makeStore } from '../lib/store.js';
import { blobAdapter } from '../lib/blob-adapter.js';
import { measurementHandler } from '../lib/handlers.js';

export default measurementHandler(makeStore(blobAdapter));
