"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudFrontBackend = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const UtilsInfra_1 = require("../common/UtilsInfra");
const config_1 = require("../config");
class CloudFrontBackend {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new CloudFrontBackend();
        }
        return this.__instance;
    }
    async main(name, aliasDns, apigwDns, cfbase, s3Logs, certificate, waf) {
        const cdn = new aws.cloudfront.Distribution(`${this.config.project}-${name}-cf`, {
            enabled: true,
            comment: `${this.config.generalPrefix}-${name}-cf`,
            aliases: [aliasDns],
            priceClass: "PriceClass_100",
            webAclId: waf.arn,
            origins: [
                {
                    originId: name,
                    domainName: apigwDns,
                    customOriginConfig: {
                        httpPort: 80,
                        httpsPort: 443,
                        originProtocolPolicy: "https-only",
                        originSslProtocols: ["TLSv1.2"]
                    },
                    customHeaders: [
                        { name: "x-api-key", value: "" }
                    ]
                }
            ],
            defaultCacheBehavior: {
                targetOriginId: name,
                viewerProtocolPolicy: "redirect-to-https",
                allowedMethods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
                cachedMethods: ["GET", "HEAD", "OPTIONS"],
                compress: true,
                responseHeadersPolicyId: cfbase.hpBackend.id,
                minTtl: this.config.cfCachePolicyBackendMin,
                defaultTtl: this.config.cfCachePolicyBackendDefault,
                maxTtl: this.config.cfCachePolicyBackendMax,
                forwardedValues: {
                    queryString: false,
                    cookies: {
                        forward: "none"
                    }
                }
            },
            customErrorResponses: [
                { errorCode: 404, responseCode: 404, responsePagePath: "/errors/404.html" },
                { errorCode: 503, responseCode: 503, responsePagePath: "/errors/503.html" },
                { errorCode: 500, responseCode: 500, responsePagePath: "/errors/500.html" },
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
            loggingConfig: {
                bucket: s3Logs.bucketDomainName,
                includeCookies: false,
                prefix: `${aliasDns}/`,
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf`,
            }
        });
        UtilsInfra_1.UtilsInfra.createAliasRecord(certificate, cdn.domainName, cdn.hostedZoneId, true);
        return cdn;
    }
}
exports.CloudFrontBackend = CloudFrontBackend;
//# sourceMappingURL=CloudFrontBackend.js.map