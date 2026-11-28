import { makePgStore } from '../lib/pg-store.js';
import { measurementHandler } from '../lib/handlers.js';

export default measurementHandler(makePgStore());
