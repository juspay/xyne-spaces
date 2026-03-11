import React from "react";

const layout = ({ children }: { children: React.ReactNode }) => {
  return <div id="main-content">{children}</div>;
};

export default layout;
