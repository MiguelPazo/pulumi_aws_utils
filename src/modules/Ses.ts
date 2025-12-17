/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class Ses {
    private static __instance: Ses;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Ses {
        if (this.__instance == null) {
            this.__instance = new Ses();
        }

        return this.__instance;
    }

    async main(
        name: string,
        zone: aws.route53.Zone,
        domain: string,
        configurationSetName?: string
    ): Promise<void> {
        const sesIdentity = new aws.ses.DomainIdentity(`${this.config.project}-${name}-ses-identity`, {
            domain,
        });

        const txtRecord = new aws.route53.Record(`${this.config.project}-${name}-ses-verification-txt-record`, {
            name: sesIdentity.verificationToken.apply(token => `_amazonses.${domain}`),
            records: [sesIdentity.verificationToken],
            ttl: 600,
            type: "TXT",
            zoneId: zone.zoneId
        });

        new aws.ses.DomainIdentityVerification(`${this.config.project}-${name}-ses-verification`, {
            domain: sesIdentity.domain,
        }, {dependsOn: [txtRecord]});

        const dkim = new aws.ses.DomainDkim(`${this.config.project}-${name}-ses-dkim`, {
            domain,
        });

        const dkimRecords = dkim.dkimTokens.apply(tokens =>
            tokens.map((token, i) =>
                new aws.route53.Record(`${domain}-ses-dkim-${i}`, {
                    name: `${token}._domainkey.${domain}`,
                    records: [`${token}.dkim.amazonses.com`],
                    ttl: 600,
                    type: "CNAME",
                    zoneId: zone.zoneId
                })
            )
        );

        /**
         * Configuration Set
         */
        if (configurationSetName) {
            new aws.ses.ConfigurationSet(`${this.config.project}-${name}-ses-config-set`, {
                name: configurationSetName,
                deliveryOptions: {
                    tlsPolicy: "Require"
                },
                reputationMetricsEnabled: true,
                sendingEnabled: true,
            });
        }
    }
}

export {Ses}
