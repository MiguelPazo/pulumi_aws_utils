/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class Ecr {
    private static __instance: Ecr;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Ecr {
        if (this.__instance == null) {
            this.__instance = new Ecr();
        }

        return this.__instance;
    }

    async main(
        service: string,
        // execRole: pulumi.Output<aws.iam.Role>,
        immutable?: boolean
    ): Promise<aws.ecr.Repository> {
        const ecrRepo = new aws.ecr.Repository(`${this.config.project}-${service}-ecr`, {
            name: `${this.config.generalPrefix}/${service}`,
            imageTagMutability: immutable === true ? "IMMUTABLE" : "MUTABLE",
            imageScanningConfiguration: {
                scanOnPush: true
            },
            encryptionConfigurations: [
                {
                    encryptionType: "AES256"
                }
            ],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}/${service}`,
            }
        });

        // new aws.ecr.RepositoryPolicy(`${this.config.project}-${service}-ecr-policy`, {
        //     repository: ecrRepo.name,
        //     policy: pulumi.output(execRole.arn).apply(x => {
        //         return JSON.stringify({
        //             "Version": "2008-10-17",
        //             "Statement": [
        //                 {
        //                     "Effect": "Allow",
        //                     "Principal": {
        //                         "AWS": x.toString()
        //                     },
        //                     "Action": [
        //                         "ecr:GetDownloadUrlForLayer",
        //                         "ecr:BatchGetImage",
        //                         "ecr:BatchCheckLayerAvailability",
        //                     ]
        //                 }
        //             ]
        //         })
        //     })
        // });

        return ecrRepo;
    }
}

export {Ecr}
