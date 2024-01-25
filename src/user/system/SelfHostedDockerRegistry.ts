import ApiStatusCodes from '../../api/ApiStatusCodes'
import DataStore from '../../datastore/DataStore'
import DockerApi from '../../docker/DockerApi'
import CaptainConstants from '../../utils/CaptainConstants'
import Logger from '../../utils/Logger'
import CertbotManager from './CertbotManager'
import LoadBalancerManager from './LoadBalancerManager'
import fs = require('fs-extra')
import bcrypt = require('bcryptjs')

class SelfHostedDockerRegistry {
    constructor(
        private dockerApi: DockerApi,
        private dataStore: DataStore,
        private certbotManager: CertbotManager,
        private loadBalancerManager: LoadBalancerManager,
        private myNodeId: string
    ) {
        //
    }

    enableRegistrySsl() {
        const self = this

        return Promise.resolve()
            .then(function () {
                return self.dataStore.getHasRootSsl()
            })
            .then(function (rootHasSsl) {
                if (!rootHasSsl) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.ILLEGAL_OPERATION,
                        'Root must have SSL before enabling ssl for docker registry.'
                    )
                }

                return self.certbotManager.enableSsl(
                    `${
                        CaptainConstants.registrySubDomain
                    }.${self.dataStore.getRootDomain()}`
                )
            })
            .then(function () {
                return self.dataStore.setHasRegistrySsl(true)
            })
            .then(function () {
                Logger.d(
                    'Updating Load Balancer - SelfHostedDockerRegistry.enableRegistrySsl'
                )
                return self.loadBalancerManager.rePopulateNginxConfigFile(
                    self.dataStore
                )
            })
    }

    getLocalRegistryDomainAndPort() {
        const self = this

        return `${
            CaptainConstants.registrySubDomain
        }.${self.dataStore.getRootDomain()}:${
            CaptainConstants.configs.registrySubDomainPort
        }`
    }

    ensureServiceRemoved() {
        const dockerApi = this.dockerApi
        const self = this
        return Promise.resolve() //
            .then(function () {
                return self.dataStore.setHasRegistrySsl(false)
            })
            .then(function () {
                return dockerApi.isServiceRunningByName(
                    CaptainConstants.registryServiceName
                )
            })
            .then(function (isRunning) {
                if (!isRunning) return

                return dockerApi.removeServiceByName(
                    CaptainConstants.registryServiceName
                )
            })
    }

    ensureDockerRegistryRunningOnThisNode(password: string) {
        const dockerApi = this.dockerApi
        const dataStore = this.dataStore

        function createRegistryServiceOnNode(nodeId: string) {
            return dockerApi
                .createServiceOnNodeId(
                    CaptainConstants.configs.registryImageName,
                    CaptainConstants.registryServiceName,
                    undefined,
                    nodeId,
                    undefined,
                    [
                        {
                            key: 'REGISTRY_STORAGE_DELETE_ENABLED',
                            value: 'true',
                        },
                    ],
                    undefined
                )
                .then(function () {
                    const waitTimeInMillis = 5000
                    Logger.d(
                        `Waiting for ${
                            waitTimeInMillis / 1000
                        } seconds for Registry to start up`
                    )
                    return new Promise<boolean>(function (resolve, reject) {
                        setTimeout(function () {
                            resolve(true)
                        }, waitTimeInMillis)
                    })
                })
        }

        const myNodeId = this.myNodeId

        return Promise.resolve()
            .then(function () {
                const authContent = `${
                    CaptainConstants.captainRegistryUsername
                }:${bcrypt.hashSync(password, bcrypt.genSaltSync(10))}`

                return fs.outputFile(
                    CaptainConstants.registryAuthPathOnHost,
                    authContent
                )
            })
            .then(function () {
                return dockerApi.isServiceRunningByName(
                    CaptainConstants.registryServiceName
                )
            })
            .then(function (isRunning) {
                if (isRunning) {
                    Logger.d('Captain Registry is already running.. ')

                    return dockerApi.getNodeIdByServiceName(
                        CaptainConstants.registryServiceName,
                        0
                    )
                } else {
                    Logger.d(
                        'No Captain Registry service is running. Creating one...'
                    )

                    return createRegistryServiceOnNode(myNodeId).then(
                        function () {
                            return myNodeId
                        }
                    )
                }
            })
            .then(function (nodeId) {
                if (nodeId !== myNodeId) {
                    Logger.d(
                        'Captain Registry is running on a different node. Removing...'
                    )

                    return dockerApi
                        .removeServiceByName(
                            CaptainConstants.registryServiceName
                        )
                        .then(function () {
                            Logger.d('Creating Registry on this node...')

                            return createRegistryServiceOnNode(myNodeId).then(
                                function () {
                                    return true
                                }
                            )
                        })
                } else {
                    return true
                }
            })
            .then(function () {
                Logger.d('Updating Certbot service...')

                return dockerApi.updateService(
                    CaptainConstants.registryServiceName,
                    CaptainConstants.configs.registryImageName,
                    [
                        {
                            containerPath: '/cert-files',
                            hostPath: CaptainConstants.letsEncryptEtcPath,
                        },
                        {
                            containerPath: '/var/lib/registry',
                            hostPath: CaptainConstants.registryPathOnHost,
                        },
                        {
                            containerPath: '/etc/auth',
                            hostPath: CaptainConstants.registryAuthPathOnHost,
                        },
                    ],
                    // No need for registry to be connected to the network
                    undefined,
                    [
                        {
                            key: 'REGISTRY_HTTP_TLS_CERTIFICATE',
                            value: `/cert-files/live/${
                                CaptainConstants.registrySubDomain
                            }.${dataStore.getRootDomain()}/fullchain.pem`,
                        },
                        {
                            key: 'REGISTRY_HTTP_TLS_KEY',
                            value: `/cert-files/live/${
                                CaptainConstants.registrySubDomain
                            }.${dataStore.getRootDomain()}/privkey.pem`,
                        },
                        {
                            key: 'REGISTRY_AUTH',
                            value: 'htpasswd',
                        },
                        {
                            key: 'REGISTRY_AUTH_HTPASSWD_REALM',
                            value: 'Registry Realm',
                        },
                        {
                            key: 'REGISTRY_AUTH_HTPASSWD_PATH',
                            value: '/etc/auth',
                        },
                        {
                            key: 'REGISTRY_STORAGE_DELETE_ENABLED',
                            value: 'true',
                        },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    [
                        {
                            protocol: 'tcp',
                            containerPort: 5000,
                            hostPort:
                                CaptainConstants.configs.registrySubDomainPort,
                        },
                    ],
                    undefined,
                    undefined,
                    undefined,
                    undefined
                )
            })
    }
}

export default SelfHostedDockerRegistry
