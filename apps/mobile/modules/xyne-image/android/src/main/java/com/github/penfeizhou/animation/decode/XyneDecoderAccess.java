package com.github.penfeizhou.animation.decode;

/**
 * Reads what `FrameSeqDecoder` keeps protected. Lives in the decoder's own
 * package because Java opens protected members to it; nothing else is here.
 */
public final class XyneDecoderAccess {
  private XyneDecoderAccess() {}

  /** How many times the file asks to be played; 0 means forever. */
  public static int loopCount(FrameSeqDecoder<?, ?> decoder) {
    return decoder.getLoopCount();
  }
}
