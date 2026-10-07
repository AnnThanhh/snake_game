// A broad phase only; callers still perform their exact distance tests.
export class SpatialGrid {
  constructor(size=180) { this.size=size;this.cells=new Map(); }
  add(entity) {
    const key=`${Math.floor(entity.x/this.size)},${Math.floor(entity.y/this.size)}`;
    if(!this.cells.has(key))this.cells.set(key,[]);
    this.cells.get(key).push(entity);
  }
  query(x,y,radius) {
    const found=[];
    for(let cy=Math.floor((y-radius)/this.size);cy<=Math.floor((y+radius)/this.size);cy++)
      for(let cx=Math.floor((x-radius)/this.size);cx<=Math.floor((x+radius)/this.size);cx++)
        found.push(...(this.cells.get(`${cx},${cy}`)||[]));
    return found;
  }
}
