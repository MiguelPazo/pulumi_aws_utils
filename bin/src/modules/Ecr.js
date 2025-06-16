"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ecr = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
const config_1 = require("../config");
class Ecr {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new Ecr();
        }
        return this.__instance;
    }
    async main(service, execRole, immutable) {
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
        new aws.ecr.RepositoryPolicy(`${this.config.project}-${service}-ecr-policy`, {
            repository: ecrRepo.name,
            policy: pulumi.output(execRole.arn).apply(x => {
                return JSON.stringify({
                    "Version": "2008-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {
                                "AWS": x.toString()
                            },
                            "Action": [
                                "ecr:GetDownloadUrlForLayer",
                                "ecr:BatchGetImage",
                                "ecr:BatchCheckLayerAvailability",
                            ]
                        }
                    ]
                });
            })
        });
        return ecrRepo;
    }
}
exports.Ecr = Ecr;
//# sourceMappingURL=Ecr.js.map