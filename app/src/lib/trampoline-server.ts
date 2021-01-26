import { createServer, AddressInfo, Server, Socket } from 'net'
import split2 from 'split2'

interface ITrampolineCommand {
  readonly identifier: string
  readonly parameters: ReadonlyArray<string>
}

enum TrampolineCommandParserState {
  Identifier,
  ParameterCount,
  Parameters,
  Finished,
}

class TrampolineCommandParser {
  private identifier: string | null = null
  private parameterCount: number = 0
  private readonly parameters: string[] = []

  private state: TrampolineCommandParserState =
    TrampolineCommandParserState.Identifier

  public hasFinished() {
    return this.state === TrampolineCommandParserState.Finished
  }

  public processValue(value: string) {
    switch (this.state) {
      case TrampolineCommandParserState.Identifier:
        this.identifier = value
        console.log(`Trampoline parsed identifier ${value}`)
        this.state = TrampolineCommandParserState.ParameterCount
        break

      case TrampolineCommandParserState.ParameterCount:
        this.parameterCount = parseInt(value)
        console.log(`Trampoline parsed parameterCount ${value}`)

        if (this.parameterCount > 0) {
          this.state = TrampolineCommandParserState.Parameters
        } else {
          this.state = TrampolineCommandParserState.Finished
        }

        break

      case TrampolineCommandParserState.Parameters:
        console.log(`Trampoline parsed parameter ${value}`)
        this.parameters.push(value)
        if (this.parameters.length === this.parameterCount) {
          this.state = TrampolineCommandParserState.Finished
        }
        break

      default:
        throw new Error(`Received value during invalid state: ${this.state}`)
    }
  }

  public toCommand(): ITrampolineCommand {
    if (this.hasFinished() === false) {
      throw new Error(
        'The command cannot be generated if parsing is not finished'
      )
    }

    const identifier = this.identifier

    if (identifier === null) {
      throw new Error('The command identifier cannot be null')
    }

    return {
      identifier,
      parameters: this.parameters,
    }
  }
}

export type TrampolineCommandHandler = (
  command: ITrampolineCommand
) => Promise<string | undefined>

export class TrampolineServer {
  private readonly server: Server
  private listeningPromise: Promise<void> | null = null

  private readonly commandHandlers = new Map<string, TrampolineCommandHandler>()

  public constructor() {
    this.server = createServer(this.onNewConnection.bind(this))
  }

  public async run(): Promise<void> {
    await this.listen()

    // TODO: retry if it fails? crash the app instead?
  }

  private async listen(): Promise<void> {
    this.listeningPromise = new Promise((resolve, reject) => {
      function onListenError(error: Error) {
        reject(error)
      }

      this.server.on('error', onListenError)

      this.server.listen(0, '127.0.0.1', async () => {
        this.server.off('error', onListenError)
        this.server.on('error', this.onErrorReceived)
        resolve()

        console.log(`Trampoline server port: ${await this.getPort()}`)
      })
    })

    return this.listeningPromise
  }

  public async getPort() {
    if (this.listeningPromise === null) {
      return null
    }

    await this.listeningPromise

    const address = this.server.address() as AddressInfo

    if (address && address.port) {
      return address.port
    }

    return null
  }

  private onNewConnection(socket: Socket) {
    socket
      .pipe(split2(/\0/))
      .on(
        'data',
        this.onDataReceived.bind(this, socket, new TrampolineCommandParser())
      )
  }

  private onDataReceived(
    socket: Socket,
    parser: TrampolineCommandParser,
    data: Buffer
  ) {
    const value = data.toString('utf8')
    parser.processValue(value)

    if (parser.hasFinished()) {
      this.processCommand(socket, parser.toCommand())
    }
  }

  public registerCommandHandler(
    identifier: string,
    handler: TrampolineCommandHandler
  ) {
    this.commandHandlers.set(identifier, handler)
  }

  private async processCommand(socket: Socket, command: ITrampolineCommand) {
    console.log(
      `command '${command.identifier}' with arguments ${command.parameters}`
    )

    const handler = this.commandHandlers.get(command.identifier)

    if (handler === undefined) {
      return
    }

    const result = await handler(command)

    if (result !== undefined) {
      socket.end(result)
    }
  }

  private onErrorReceived(error: Error) {
    console.error('Error received in trampoline server:', error)
    // TODO: try to run the server again?
  }
}

export const trampolineServer = new TrampolineServer()
