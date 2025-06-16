"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rds = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
const config_1 = require("../config");
const awsx = require("@pulumi/awsx");
class Rds {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new Rds();
        }
        return this.__instance;
    }
    async main(rdsConfig, vpc, phz) {
        /**
         * KMS
         */
        const kmsRds = new aws.kms.Key(`${this.config.project}-rds-${rdsConfig.engine}-kms`, {
            description: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-kms`,
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            enableKeyRotation: true,
            policy: pulumi.output(this.config.accountId).apply(x => {
                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Sid: "EnableRootPermissions",
                            Effect: "Allow",
                            Principal: {
                                AWS: `arn:aws:iam::${x}:root`,
                            },
                            Action: "kms:*",
                            Resource: "*",
                        },
                        {
                            Sid: "AllowRDSUsage",
                            Effect: "Allow",
                            Principal: {
                                Service: "rds.amazonaws.com",
                            },
                            Action: [
                                "kms:Encrypt",
                                "kms:Decrypt",
                                "kms:ReEncrypt*",
                                "kms:GenerateDataKey*",
                                "kms:DescribeKey"
                            ],
                            Resource: "*",
                        }
                    ]
                });
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-kms`
            }
        });
        new aws.kms.Alias(`${this.config.project}-rds-${rdsConfig.engine}-kms-alias`, {
            name: `alias/${this.config.generalPrefix}-rds-${rdsConfig.engine}-kms`,
            targetKeyId: kmsRds.keyId
        });
        /**
         * SG
         */
        const securityGroup = vpc.apply(x => {
            return new awsx.classic.ec2.SecurityGroup(`${this.config.project}-rds-${rdsConfig.engine}-sg`, {
                description: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-sg`,
                vpc: x,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-sg`,
                },
            });
        });
        /**
         * Database
         */
        const subnetGroup = new aws.rds.SubnetGroup(`${this.config.project}-rds-${rdsConfig.engine}-subgrup`, {
            name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-subgrup`,
            subnetIds: vpc.isolatedSubnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-subgrup`,
            }
        });
        const rdsInstance = new aws.rds.Instance(`${this.config.project}-rds-${rdsConfig.engine}`, {
            allocatedStorage: 20,
            engine: rdsConfig.engine,
            engineVersion: rdsConfig.engineVersion,
            instanceClass: rdsConfig.instanceClass,
            kmsKeyId: kmsRds.arn,
            storageEncrypted: true,
            dbName: rdsConfig.dbName,
            port: rdsConfig.port,
            username: rdsConfig.username,
            password: rdsConfig.password,
            dbSubnetGroupName: subnetGroup.name,
            vpcSecurityGroupIds: [securityGroup.securityGroup.id],
            skipFinalSnapshot: rdsConfig.skipFinalSnapshot,
            publiclyAccessible: rdsConfig.publiclyAccessible
        });
        /**
         * DNS
         */
        rdsInstance.endpoint.apply(x => {
            x = x.split(":")[0];
            new aws.route53.Record(`${this.config.project}-rds-${rdsConfig.engine}-reader-dns`, {
                name: rdsConfig.domainRdsReader,
                type: "CNAME",
                zoneId: phz.zone.zoneId,
                ttl: 300,
                records: [x],
            });
            new aws.route53.Record(`${this.config.project}-rds-${rdsConfig.engine}-writer-dns`, {
                name: rdsConfig.domainRdsWriter,
                type: "CNAME",
                zoneId: phz.zone.zoneId,
                ttl: 300,
                records: [x],
            });
        });
        return {
            rdsInstance,
            kmsRds,
            securityGroup,
        };
    }
}
exports.Rds = Rds;
//# sourceMappingURL=Rds.js.map