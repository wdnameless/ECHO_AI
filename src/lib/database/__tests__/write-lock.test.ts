import { describe, it, expect } from "vitest";
import { withWriteLock } from "../config";

/**
 * Every transaction-scoped writer shares ONE plugin connection, and
 * `BEGIN TRANSACTION` is connection-wide. Two overlapping saves used to
 * interleave — the second BEGIN failed, the first COMMIT closed the shared
 * transaction, and the second one died with
 *
 *   cannot commit - no transaction is active
 *
 * which the meeting screen logged while recording: the turn was on screen and
 * never reached the database. Reproduced on a single node:sqlite connection
 * (BEGIN, BEGIN, COMMIT, COMMIT) before this lock existed.
 */
describe("write lock", () => {
  /** A shared resource that fails if two holders interleave, like one connection. */
  function makeConnection() {
    let inTransaction = false;
    const log: string[] = [];
    return {
      log,
      async begin(tag: string) {
        if (inTransaction) throw new Error("cannot start a transaction within a transaction");
        inTransaction = true;
        log.push(`${tag}:begin`);
      },
      async commit(tag: string) {
        if (!inTransaction) throw new Error("cannot commit - no transaction is active");
        inTransaction = false;
        log.push(`${tag}:commit`);
      },
    };
  }

  it("serialises two writers that would otherwise interleave", async () => {
    const conn = makeConnection();
    const writer = (tag: string, delay: number) =>
      withWriteLock(async () => {
        await conn.begin(tag);
        await new Promise((r) => setTimeout(r, delay));
        await conn.commit(tag);
      });

    // The second writer sleeps less: without the lock it would finish inside
    // the first one's transaction.
    await Promise.all([writer("A", 30), writer("B", 5)]);

    expect(conn.log).toEqual(["A:begin", "A:commit", "B:begin", "B:commit"]);
  });

  it("runs many writers without ever overlapping", async () => {
    const conn = makeConnection();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withWriteLock(async () => {
          await conn.begin(`w${i}`);
          await conn.commit(`w${i}`);
        })
      )
    );
    // Every begin is immediately followed by its own commit.
    for (let i = 0; i < conn.log.length; i += 2) {
      const [beginTag] = conn.log[i].split(":");
      const [commitTag] = conn.log[i + 1].split(":");
      expect(commitTag).toBe(beginTag);
    }
  });

  it("does not deadlock after a writer throws", async () => {
    await expect(
      withWriteLock(async () => {
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");

    // The chain must stay usable: a rejected writer cannot block the next one.
    await expect(withWriteLock(async () => "ok")).resolves.toBe("ok");
  });
});
