/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {PhzResult, RdsConfig, RdsResult, VpcImportResult} from "../types";

class Rds {
    private static __instance: Rds;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Rds {
        if (this.__instance == null) {
            this.__instance = new Rds();
        }

        return this.__instance;
    }

    async main(
        rdsConfig: RdsConfig,
        vpc: pulumi.Output<VpcImportResult>,
        subnetIds: pulumi.Output<string[]>,
        kmsKey?: pulumi.Output<aws.kms.Key>,
        phz?: pulumi.Output<PhzResult>,
        publicZoneRoodId?: pulumi.Output<string>,
    ): Promise<RdsResult> {
        /**
         * KMS
         */
        const kms = kmsKey || new aws.kms.Key(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-kms`, {
            description: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-kms`,
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
                                "kms:List",
                                "kms:ReEncrypt*",
                                "kms:GenerateDataKey*",
                                "kms:DescribeKey"
                            ],
                            Resource: "*",
                        }
                    ]
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-kms`
            }
        });

        if (!kmsKey) {
            new aws.kms.Alias(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-kms`,
                targetKeyId: kms.keyId
            });
        }

        /**
         * SG
         */
        const securityGroup = new aws.ec2.SecurityGroup(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-sg`, {
            name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-sg`,
            description: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-sg`,
            vpcId: vpc.id,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-sg`,
            },
        });

        /**
         * Database
         */
        const subnetGroup = new aws.rds.SubnetGroup(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-subgrup`, {
            name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-subgrup`,
            subnetIds: subnetIds,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-subgrup`,
            }
        });

        const paramGroup = new aws.rds.ParameterGroup(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-paramgroup`, {
            name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-paramgroup`,
            description: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-paramgroup`,
            family: rdsConfig.parameterGroupFamily,
            parameters: rdsConfig.parameterGroupValues,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}-paramgroup`,
            }
        });

        const instance = new aws.rds.Instance(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}`, {
            identifier: `${this.config.generalPrefix}-rds-${rdsConfig.engine}-${rdsConfig.name}`,
            allocatedStorage: 20,
            engine: rdsConfig.engine,
            engineVersion: rdsConfig.engineVersion,
            instanceClass: rdsConfig.instanceClass,
            kmsKeyId: kms.arn,
            storageEncrypted: true,
            port: rdsConfig.port,
            username: rdsConfig.username,
            password: rdsConfig.password,
            dbSubnetGroupName: subnetGroup.name,
            parameterGroupName: paramGroup.name,
            vpcSecurityGroupIds: [securityGroup.id],
            skipFinalSnapshot: rdsConfig.skipFinalSnapshot,
            publiclyAccessible: rdsConfig.publiclyAccessible
        });

        /**
         * DNS
         */
        if (rdsConfig.domainRdsReader && rdsConfig.domainRdsWriter) {
            instance.endpoint.apply(x => {
                x = x.split(":")[0];

                new aws.route53.Record(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-reader-dns`, {
                    name: rdsConfig.domainRdsReader,
                    type: "CNAME",
                    zoneId: phz ? phz.zone.zoneId : publicZoneRoodId,
                    ttl: 300,
                    records: [x],
                });

                new aws.route53.Record(`${this.config.project}-rds-${rdsConfig.engine}-${rdsConfig.name}-writer-dns`, {
                    name: rdsConfig.domainRdsWriter,
                    type: "CNAME",
                    zoneId: phz ? phz.zone.zoneId : publicZoneRoodId,
                    ttl: 300,
                    records: [x],
                });
            });
        }

        return {
            instance,
            kms,
            securityGroup,
        } as RdsResult
    }
}

export {Rds}
