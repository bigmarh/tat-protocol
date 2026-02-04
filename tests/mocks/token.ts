export type Payload = Record<string, unknown>;
export type Header = Record<string, unknown>;

export enum TokenType {
  FUNGIBLE = "FUNGIBLE",
  TAT = "TAT",
}

export class Token {
  public payload!: Payload;
  public header!: Header;

  async restore(tokenString: string): Promise<Token> {
    const parsed = JSON.parse(tokenString) as { payload: Payload; header: Header };
    this.payload = parsed.payload;
    this.header = parsed.header;
    return this;
  }

  async validate(): Promise<boolean> {
    return true;
  }
}

export default Token;
