import { Logging } from 'homebridge';
import { promises } from 'fs';
import { join } from 'path';

const SCHEMA_VERSION = 1;
const PLUGIN_NAME = 'homebridge-nest-cam';

interface Structure {
  name: string;
  id: string;
}

export interface Schema {
  structures: Array<Structure>;
}

export class ConfigSchema {
  private readonly log: Logging;
  private inputFile: string;
  private outputFile: string;
  private schema: Schema;

  constructor(schema: Schema, path: string, log: Logging) {
    // The full path to the schema file
    this.inputFile = join(__dirname, '../config.schema.json');
    this.outputFile = join(path, '.' + PLUGIN_NAME + '-v' + SCHEMA_VERSION + '.schema.json');
    this.log = log;
    this.schema = schema;
  }

  private getStructures(): Array<any> {
    const structures: Array<any> = [];
    this.schema.structures.forEach((structure) => {
      structures.push({ title: structure.name, enum: [structure.id] });
    });

    return structures;
  }

  private async readSchemaFile(): Promise<any> {
    try {
      const data = await promises.readFile(this.inputFile, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      this.log.error(`Failed to read a configuration schema: ${err.message}`);
    }
    return;
  }

  private async writeSchemaFile(data: any): Promise<void> {
    try {
      await promises.writeFile(this.outputFile, JSON.stringify(data), 'utf8');
    } catch (err) {
      this.log.error(`Failed to write a new configuration schema: ${err.message}`);
    }
  }

  async generate(): Promise<void> {
    const data = await this.readSchemaFile();
    if (data) {
      const structures = this.getStructures();
      if (
        data &&
        data.schema &&
        data.schema.options &&
        data.schema.options.properties &&
        data.schema.options.properties.structures &&
        data.schema.options.properties.structures.items
      ) {
        if (structures.length > 0) {
          data.schema.options.properties.structures.items.oneOf = structures;
        } else if (data.schema.options.properties.structures.items.oneOf) {
          delete data.schema.options.properties.structures.items.oneOf;
        }
        await this.writeSchemaFile(data);
      }
    }
  }
}
