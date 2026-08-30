import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export const Completion = ({
  isHidden,
  suppressAutoVAD,
}: {
  isHidden: boolean;
  suppressAutoVAD?: boolean;
}) => {
  const completion = useCompletion();

  return (
    <>
      <Audio {...completion} suppressAutoVAD={suppressAutoVAD} />
      <Input {...completion} isHidden={isHidden} />
      <Screenshot {...completion} />
      <Files {...completion} />
    </>
  );
};
