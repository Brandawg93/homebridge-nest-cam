import Pbf from 'pbf';

export class DirectorsCutRegion {
  public static read(pbf: Pbf, end?: any): any {
    return pbf.readFields(DirectorsCutRegion._readField, { id: 0, left: 0, right: 0, top: 0, bottom: 0 }, end);
  }

  private static _readField(tag: number, obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (tag === 1) obj.id = pbf.readVarint();
      else if (tag === 2) obj.left = pbf.readVarint();
      else if (tag === 3) obj.right = pbf.readVarint();
      else if (tag === 4) obj.top = pbf.readVarint();
      else if (tag === 5) obj.bottom = pbf.readVarint();
    }
  }

  public static write(obj: any, pbf: Pbf | undefined): void {
    if (pbf) {
      if (obj.id) pbf.writeVarintField(1, obj.id);
      if (obj.left) pbf.writeVarintField(2, obj.left);
      if (obj.right) pbf.writeVarintField(3, obj.right);
      if (obj.top) pbf.writeVarintField(4, obj.top);
      if (obj.bottom) pbf.writeVarintField(5, obj.bottom);
    }
  }
}
