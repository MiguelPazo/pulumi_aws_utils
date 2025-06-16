"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiGateway = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const fs = require("fs");
const crypto = require("crypto");
const yaml = require("js-yaml");
const UtilsInfra_1 = require("../common/UtilsInfra");
const config_1 = require("../config");
class ApiGateway {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new ApiGateway();
        }
        return this.__instance;
    }
    async main(name, template, certificates, enableLogs, enableXRay) {
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
        let logGroup;
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
                format: `$context.extendedRequestId $context.identity.sourceIp ` +
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
            UtilsInfra_1.UtilsInfra.createAliasRecord(cert, domainNameResource.regionalDomainName, domainNameResource.regionalZoneId, false);
        }
        return api;
    }
}
exports.ApiGateway = ApiGateway;
//# sourceMappingURL=ApiGateway.js.map