/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as crypto from "crypto";
import {CertificatesResult} from "../types";
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
        isPrivate: boolean,
        template?: string,
        certificates?: CertificatesResult[],
        logLevel?: string,
        enableLogs?: boolean,
        enableXRay?: boolean,
        privateVpcEndpointIds?: pulumi.Output<string>[],
        ignoreOpenApiChanges?: boolean,
    ): Promise<aws.apigateway.RestApi> {
        logLevel = logLevel == undefined ? "INFO" : logLevel;
        ignoreOpenApiChanges = ignoreOpenApiChanges == undefined ? false : ignoreOpenApiChanges;
        const openApiSpec = yaml.load(template);

        /**
         * ApiGateway
         */
        const api = new aws.apigateway.RestApi(`${this.config.project}-${name}-apirest`, {
            name: `${this.config.generalPrefix}-${name}-apirest`,
            body: JSON.stringify(openApiSpec),
            endpointConfiguration: {
                types: isPrivate ? "PRIVATE" : "REGIONAL",
                vpcEndpointIds: isPrivate ? privateVpcEndpointIds : undefined,
            },
            policy: isPrivate ? pulumi.all([this.config.region, this.config.accountId, privateVpcEndpointIds]).apply(
                ([region, accountId, endpoints]) => {
                    return JSON.stringify({
                        Version: "2012-10-17",
                        Statement: [
                            {
                                Effect: "Deny",
                                Principal: "*",
                                Action: "execute-api:Invoke",
                                Resource: `arn:aws:execute-api:${region}:${accountId}:*/*`,
                                Condition: {
                                    StringNotEquals: {
                                        "aws:SourceVpce": endpoints,
                                    },
                                },
                            },
                            {
                                Effect: "Allow",
                                Principal: "*",
                                Action: "execute-api:Invoke",
                                Resource: `arn:aws:execute-api:${region}:${accountId}:*/*`,
                            }
                        ],
                    })
                }) : undefined,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-apirest`,
            }
        }, {
            ignoreChanges: ignoreOpenApiChanges ? ["body"] : undefined
        });

        const redeploymentHash = pulumi.all([api.body]).apply(([body]) => {
            const data = JSON.stringify([body]);
            return crypto.createHash("sha1").update(data).digest("hex");
        });

        const deployment = new aws.apigateway.Deployment(`${this.config.project}-${name}-apirest-deployment`, {
            restApi: api.id,
            triggers: ignoreOpenApiChanges ? undefined : {
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

        /**
         * Logs
         */
        if (enableLogs) {
            new aws.apigateway.MethodSettings(`${this.config.project}-${name}-apirest-method`, {
                restApi: api.id,
                stageName: stage.stageName,
                methodPath: "*/*",
                settings: {
                    metricsEnabled: true,
                    loggingLevel: logLevel
                },
            });
        }

        /**
         * DNS
         */
        certificates.forEach((cert, index) => {
            const domainNameResource = new aws.apigateway.DomainName(`${this.config.project}-${name}-apirest-domain-${index}`, {
                domainName: cert.domain,
                regionalCertificateArn: !isPrivate ? cert.arn : undefined,
                certificateArn: isPrivate ? cert.arn : undefined,
                securityPolicy: "TLS_1_2",
                endpointConfiguration: {
                    types: isPrivate ? "PRIVATE" : "REGIONAL",
                },
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${name}-apirest-domain-${index}`,
                }
            });

            if (isPrivate) {
                pulumi.output(privateVpcEndpointIds).apply(endpoints => {
                    endpoints.forEach((endpointId, i) => {
                        new aws.apigateway.DomainNameAccessAssociation(`${this.config.project}-${name}-apirest-domain-assoc-${index}-${i}`, {
                            accessAssociationSource: endpointId,
                            accessAssociationSourceType: "VPCE",
                            domainNameArn: domainNameResource.arn
                        });
                    })
                })
            }

            new aws.apigateway.BasePathMapping(`${this.config.project}-${name}-apirest-domain-map-${index}`, {
                domainName: domainNameResource.domainName,
                domainNameId: domainNameResource.domainNameId,
                restApi: api.id,
                stageName: stage.stageName,
            }, {
                dependsOn: [domainNameResource, stage],
            });

            if (!isPrivate) {
                UtilsInfra.createAliasRecord(cert, domainNameResource.regionalDomainName, domainNameResource.regionalZoneId, false);
            }
        });


        return api
    }
}

export {ApiGateway}
