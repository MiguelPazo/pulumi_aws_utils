/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as crypto from "crypto";
import {CertificatesResult} from "../types/base";
import * as yaml from "js-yaml";
import {UtilsInfra} from "../common/UtilsInfra";
import {getInit} from "../config";
import {InitConfig} from "../types/module";

class ApiGateway {
    private static __instance: ApiGateway;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): ApiGateway {
        if (this.__instance == null) {
            this.__instance = new ApiGateway();
        }

        return this.__instance;
    }

    async main(
        name: string,
        template?: string,
        certificates?: CertificatesResult[],
        enableLogs?: boolean,
        enableXRay?: boolean,
    ): Promise<aws.apigateway.RestApi> {
        const openApiSpec = yaml.load(fs.readFileSync(template, "utf8"));

        const api = new aws.apigateway.RestApi(`${this.config.project}-${name}-apirest`, {
            name: `${this.config.generalPrefix}-${name}-apirest`,
            body: JSON.stringify(openApiSpec),
            endpointConfiguration: {
                types: "REGIONAL"
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apirest`,
            }
        });

        const redeploymentHash = pulumi.all([api.body]).apply(([body]) => {
            const data = JSON.stringify([body]);
            return crypto.createHash("sha1").update(data).digest("hex");
        });

        const deployment = new aws.apigateway.Deployment(`${this.config.project}-${name}-apirest-deployment`, {
            restApi: api.id,
            triggers: {
                redeployment: redeploymentHash,
            },
        });

        let logGroup: aws.cloudwatch.LogGroup;

        if (enableLogs) {
            logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-${name}-apirest-logs`, {
                name: `/aws/apigateway/${this.config.generalPrefix}-${name}`,
                retentionInDays: this.config.cloudwatchRetentionLogs,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${name}-apirest-logs`,
                }
            });
        }

        const stage = new aws.apigateway.Stage(`${this.config.project}-${name}-apirest-stage`, {
            stageName: this.config.stack,
            restApi: api.id,
            deployment: deployment.id,
            xrayTracingEnabled: enableXRay,
            accessLogSettings: enableLogs ? {
                destinationArn: logGroup.arn,
                format:
                    `$context.extendedRequestId $context.identity.sourceIp ` +
                    `$context.identity.caller $context.identity.user ` +
                    `[$context.requestTime] $context.httpMethod ` +
                    `$context.resourcePath $context.protocol ` +
                    `$context.status $context.responseLength $context.requestId`,
            } : undefined,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apirest-stage`,
            }
        }, {
            deleteBeforeReplace: true
        });

        if (enableLogs) {
            new aws.apigateway.MethodSettings(`${this.config.project}-${name}-apirest-method`, {
                restApi: api.id,
                stageName: stage.stageName,
                methodPath: "*/*",
                settings: {
                    metricsEnabled: true,
                    loggingLevel: this.config.apigwLogLevel
                },
            });
        }

        /**
         * DNS
         */
        let count = 0;
        for (const cert of certificates) {
            count++;

            const domainNameResource = new aws.apigateway.DomainName(`${this.config.project}-${name}-apirest-domain-${count}`, {
                domainName: cert.domain,
                regionalCertificateArn: cert.arn,
                endpointConfiguration: {
                    types: "REGIONAL",
                },
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${name}-apirest-domain-${count}`,
                }
            });

            new aws.apigateway.BasePathMapping(`${this.config.project}-${name}-apirest-domain-map-${count}`, {
                domainName: cert.domain,
                restApi: api.id,
                stageName: stage.stageName,
            }, {
                dependsOn: [domainNameResource, stage],
            });

            UtilsInfra.createAliasRecord(cert, domainNameResource.regionalDomainName, domainNameResource.regionalZoneId, false);
        }


        return api
    }
}

export {ApiGateway}
