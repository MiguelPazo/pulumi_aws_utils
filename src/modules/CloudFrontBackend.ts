/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CloudFrontBackendModuleConfig} from "../types";
import {UtilsInfra} from "../common/UtilsInfra";
import {getInit} from "../config";
import {InitConfig} from "../types/module";

class CloudFrontBackend {
    private static __instance: CloudFrontBackend;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): CloudFrontBackend {
        if (this.__instance == null) {
            this.__instance = new CloudFrontBackend();
        }

        return this.__instance;
    }

    async main(config: CloudFrontBackendModuleConfig): Promise<aws.cloudfront.Distribution> {
        const {
            name,
            aliasDns,
            vpcOriginId,
            vpcOriginDns,
            vpcOriginPath,
            apigw,
            cfbase,
            s3Logs,
            certificate,
            waf,
            dnsRoute53
        } = config;
        // Create CloudFront distribution
        const cdn = new aws.cloudfront.Distribution(`${this.config.project}-${name}-cf`, {
            enabled: true,
            comment: `${this.config.generalPrefix}-${name}-cf`,
            aliases: aliasDns,
            priceClass: "PriceClass_100",
            webAclId: waf.arn,

            origins: [
                {
                    originId: name,
                    domainName: vpcOriginDns,
                    originPath: vpcOriginPath,
                    vpcOriginConfig: {
                        vpcOriginId: vpcOriginId
                    },
                    customHeaders: [
                        {name: "x-apigw-api-id", value: apigw.id}
                    ]
                }
            ],

            defaultCacheBehavior: pulumi.output(cfbase).apply(base => ({
                targetOriginId: name,
                viewerProtocolPolicy: "redirect-to-https",
                allowedMethods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "DELETE"],
                cachedMethods: ["GET", "HEAD", "OPTIONS"],
                compress: true,
                responseHeadersPolicyId: base.hpBackend.id,
                cachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
                originRequestPolicyId: "216adef6-5c7f-47e4-b989-5492eafa07d3",
                functionAssociations: base.functionSecureHeaders ? [{
                    eventType: "viewer-response",
                    functionArn: base.functionSecureHeaders.arn
                }] : undefined
            })),

            customErrorResponses: [
                {errorCode: 404, responseCode: 404, responsePagePath: "/errors/404.html"},
                {errorCode: 503, responseCode: 503, responsePagePath: "/errors/503.html"},
                {errorCode: 500, responseCode: 500, responsePagePath: "/errors/500.html"},
            ],

            restrictions: {
                geoRestriction: {
                    restrictionType: 'none'
                },
            },

            viewerCertificate: {
                acmCertificateArn: certificate.arn,
                sslSupportMethod: "sni-only",
                minimumProtocolVersion: "TLSv1.2_2021",
            },

            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf`,
            }
        }, {
            dependsOn: [
                apigw
            ]
        });

        /**
         * Logging configuration
         */
        const logDeliverySource = new aws.cloudwatch.LogDeliverySource(`${this.config.project}-${name}-cf-log-source`, {
            name: `${this.config.generalPrefix}-${name}-cf-logs`,
            logType: "ACCESS_LOGS",
            resourceArn: cdn.arn,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-logs`,
            }
        }, {
            provider: this.config.providerVirginia,
            dependsOn: [cdn]
        });

        const logDeliveryDestination = new aws.cloudwatch.LogDeliveryDestination(`${this.config.project}-${name}-cf-log-destination`, {
            name: `${this.config.generalPrefix}-${name}-cf-s3-destination`,
            outputFormat: "parquet",
            deliveryDestinationConfiguration: {
                destinationResourceArn: pulumi.interpolate`${s3Logs.arn}/${aliasDns[0]}/`
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-s3-destination`,
            }
        }, {
            provider: this.config.providerVirginia
        });

        new aws.cloudwatch.LogDelivery(`${this.config.project}-${name}-cf-log-delivery`, {
            deliverySourceName: logDeliverySource.name,
            deliveryDestinationArn: logDeliveryDestination.arn,
            s3DeliveryConfigurations: [{
                suffixPath: `/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}`,
                enableHiveCompatiblePath: false
            }],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-log-delivery`,
            }
        }, {
            provider: this.config.providerVirginia,
            dependsOn: [logDeliverySource, logDeliveryDestination]
        });

        // Create Route53 alias records
        if (dnsRoute53) {
            UtilsInfra.createAliasRecordWithCustomDomain(dnsRoute53, certificate, cdn.domainName, cdn.hostedZoneId, true);
        } else {
            aliasDns.forEach(alias => {
                UtilsInfra.createAliasRecordWithCustomDomain(alias, certificate, cdn.domainName, cdn.hostedZoneId, true);
            });
        }

        return cdn;
    }
}

export {CloudFrontBackend}
