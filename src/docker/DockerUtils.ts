import ApiStatusCodes from '../api/ApiStatusCodes'
import CaptainConstants from '../utils/CaptainConstants'
import Logger from '../utils/Logger'
import DockerApi from './DockerApi'
import SshClientImport = require('ssh2')
const SshClient = SshClientImport.Client

export default class DockerUtils {
    static joinDockerNode(
        dockerApi: DockerApi,
        sshUser: string,
        sshPort: number,
        captainIpAddress: string,
        isManager: boolean,
        remoteNodeIpAddress: string,
        privateKey: string
    ) {
        const remoteUserName = sshUser // Docker requires root access. It has to be root or any non root user that can run Docker without sudo

        return Promise.resolve()
            .then(function () {
                return dockerApi.getJoinToken(isManager)
            })
            .then(function (token) {
                return new Promise<void>(function (resolve, reject) {
                    const conn = new SshClient()
                    conn.on('error', function (err) {
                        Logger.e(err)
                        reject(
                            ApiStatusCodes.createError(
                                ApiStatusCodes.STATUS_ERROR_GENERIC,
                                'SSH Connection error!!'
                            )
                        )
                    })
                        .on('ready', function () {
                            Logger.d('SSH Client :: ready')
                            conn.exec(
                                `${
                                    CaptainConstants.disableFirewallCommand
                                } ${dockerApi.createJoinCommand(
                                    captainIpAddress,
                                    token,
                                    remoteNodeIpAddress
                                )}`,
                                function (err, stream) {
                                    if (err) {
                                        Logger.e(err)
                                        reject(
                                            ApiStatusCodes.createError(
                                                ApiStatusCodes.STATUS_ERROR_GENERIC,
                                                'SSH Running command failed!!'
                                            )
                                        )
                                        return
                                    }

                                    let hasExisted = false

                                    stream
                                        .on(
                                            'close',
                                            function (
                                                code: string,
                                                signal: string
                                            ) {
                                                Logger.d(
                                                    `Stream :: close :: code: ${code}, signal: ${signal}`
                                                )
                                                conn.end()
                                                if (hasExisted) {
                                                    return
                                                }
                                                hasExisted = true
                                                resolve()
                                            }
                                        )
                                        .on('data', function (data: string) {
                                            Logger.d(`STDOUT: ${data}`)
                                        })
                                        .stderr.on('data', function (data) {
                                            Logger.e(`STDERR: ${data}`)
                                            if (hasExisted) {
                                                return
                                            }
                                            hasExisted = true
                                            reject(
                                                ApiStatusCodes.createError(
                                                    ApiStatusCodes.STATUS_ERROR_GENERIC,
                                                    `Error during setup: ${data}`
                                                )
                                            )
                                        })
                                }
                            )
                        })
                        .connect({
                            host: remoteNodeIpAddress,
                            port: sshPort,
                            username: remoteUserName,
                            privateKey: privateKey,
                        })
                })
            })
    }
}
