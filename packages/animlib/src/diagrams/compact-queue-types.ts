import type {ElementHandle,Vec2} from '../types.js';
import type {CollectionItem,CollectionOptions} from './collection-types.js';

export interface CompactQueueOptions extends CollectionOptions {
  /** Visible subset at time zero. Defaults to all records in input order. */
  initialOrder?:readonly string[];
}
export interface CompactQueueTransition {
  start:number;
  duration:number;
  /** Offset from the destination slot, faded away during insertion. */
  entryOffset?:Vec2;
  /** Offset from the departure slot, reached while fading out. */
  exitOffset?:Vec2;
}
export interface CompactQueueDiagram {
  readonly items:ReadonlyMap<string,ElementHandle>;
  readonly data:readonly CollectionItem[];
  /** A fresh copy of the order after all scheduled operations. */
  readonly order:readonly string[];
  /** Surviving records must preserve their relative order. */
  transition(order:readonly string[],options:CompactQueueTransition):void;
  insert(id:string,index:number,options:CompactQueueTransition):void;
  remove(id:string,options:CompactQueueTransition):void;
}
