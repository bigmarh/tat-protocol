import { Storage } from '@tat-protocol/storage';
import { NodeStore } from '@tat-protocol/storage';

const storage = new Storage(new NodeStore()); 
console.log(storage);