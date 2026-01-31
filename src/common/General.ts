/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as archiver from "archiver";
import * as fs from "fs";
import {getInit} from "../config";

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

    static getValue<T>(output: pulumi.Output<T>): Promise<any> {
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

    static renderPolicy(filePolicy: string): pulumi.Output<any> {
        const config = getInit();

        return pulumi.all([config.accountId]).apply(([accountId]) => {
            let policyStr = fs.readFileSync(filePolicy, 'utf8')
                .replace(/rep_region/g, aws.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_general_prefix_multiregion/g, config.generalPrefixMultiregion)
                .replace(/rep_general_prefix/g, config.generalPrefix)
                .replace(/rep_stack_alias/g, config.stackAlias)
                .replace(/rep_project/g, config.project);

            return Promise.resolve(JSON.parse(policyStr));
        });
    }
}

export {General}
