/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import {Output} from "@pulumi/pulumi";
import * as archiver from "archiver";
import * as fs from "fs";

class General {
    static zipDirectory(sourceDir, outPath): Promise<any> {
        const archive = archiver("zip", {zlib: {level: 9}});
        const stream = fs.createWriteStream(outPath);

        return new Promise((resolve, reject) => {
            archive
                .directory(sourceDir, false)
                .on("error", err => reject(err))
                .pipe(stream);

            stream.on("close", () => resolve({}));
            archive.finalize();
        });
    }

    static getValue<T>(output: Output<T>): Promise<any> {
        return new Promise<T>((resolve, reject) => {
            output.apply(value => {
                resolve(value);
            });
        });
    }

    static getJsonInArray(data, key, val): any {
        for (let i in data) {
            if (data[i][key] === val) {
                return data[i];
            }
        }

        return null;
    }
}

export {General}
