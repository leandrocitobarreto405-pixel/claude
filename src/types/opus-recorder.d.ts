declare module "opus-recorder" {
  export type OpcoesRecorder = {
    encoderPath: string;
    encoderSampleRate?: number;
    encoderBitRate?: number;
    encoderApplication?: 2048 | 2049 | 2051;
    encoderFrameSize?: 2.5 | 5 | 10 | 20 | 40 | 60;
    encoderComplexity?: number;
    maxFramesPerPage?: number;
    numberOfChannels?: number;
    streamPages?: boolean;
    resampleQuality?: number;
    recordingGain?: number;
    monitorGain?: number;
    bufferLength?: number;
    mediaTrackConstraints?: boolean | MediaTrackConstraints;
  };
  export default class Recorder {
    constructor(opcoes: OpcoesRecorder);
    static isRecordingSupported(): boolean;
    ondataavailable: (dados: Uint8Array) => void;
    onstart: () => void;
    onstop: () => void;
    onpause: () => void;
    onresume: () => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): void;
    resume(): void;
    close(): void;
    setRecordingGain(ganho: number): void;
  }
}
