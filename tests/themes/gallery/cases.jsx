import React from "react";
import Button from "../../../src/components/common/Button.jsx";

export function renderCase(caseId) {
  switch (caseId) {
    case "harness-button":
      return (
        <Button type="button" onClick={() => {}}>
          Harness button
        </Button>
      );
    default:
      throw new Error(`Unknown theme gallery case: ${caseId}`);
  }
}
