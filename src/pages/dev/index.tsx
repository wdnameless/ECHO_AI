import { AIProviders } from "./components";
import { useSettings } from "@/hooks";
import { PageLayout } from "@/layouts";

const DevSpace = () => {
  const settings = useSettings();

  return (
    <PageLayout title="AI Models" description="Connect, configure and test your cloud & custom AI models">
      {/* Provider Selection & Custom Provider Form */}
      <AIProviders {...settings} />
    </PageLayout>
  );
};

export default DevSpace;
