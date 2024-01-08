const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const esprima = require("esprima");
const estraverse = require("estraverse");

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());
const fs = require("fs");

app.post("/upload", (req, res) => {
  const fileContent = req.body.fileContent;
  try {
    const context = { variables: {}, history: [] };
    const ast = esprima.parseScript(fileContent);
    traverseAst(ast, context);
    res.json({ history: context.history });
  } catch (error) {
    res
      .status(400)
      .json({ message: "Error parsing code", error: error.message });
  }
});

function traverseAst(node, context) {
  estraverse.traverse(node, {
    enter: (node) => {
      if (node.type === "VariableDeclaration") {
        handleVariableDeclaration(node, context);
      } else if (node.type === "ForStatement") {
        traverseAst(node.init, context);
        while (evaluateExpression(node.test, context)) {
          traverseAst(node.body, context);
          evaluateExpression(node.update, context);
        }
      } else if (node.type === "AssignmentExpression") {
        evaluateExpression(node, context);
      }
      if (node.type === "IfStatement") {
        const testResult = evaluateExpression(node.test, context);
        console.log(`IfStatement test result: ${testResult}`);
        if (testResult) {
          console.log(
            `Expression type inside IfStatement: ${node.consequent.type}`
          );
          traverseAst(node.consequent, context);
        } else if (node.alternate) {
          traverseAst(node.alternate, context);
        }
      }
    },
  });
}

function handleVariableDeclaration(node, context) {
  node.declarations.forEach((declaration) => {
    if (declaration.init) {
      if (declaration.init.type === "ArrayExpression") {
        // Handle array initialization
        const arrayValues = declaration.init.elements.map((element) =>
          evaluateExpression(element, context)
        );
        updateContext(declaration.id.name, arrayValues, context);
      } else {
        // Handle other initializations
        const value = evaluateExpression(declaration.init, context);
        updateContext(declaration.id.name, value, context);
      }
    }
  });
}

function handleLoopIteration(loopNode, context) {
  console.log("Handling ForStatement");
  console.log(`Initial context: ${JSON.stringify(context)}`);

  // Initialize loop variables
  console.log("Initializing loop variable");
  traverseAst(loopNode.init, context);
  updateContextHistory(context);

  const maxIterations = 1000; // Set a maximum iteration count to prevent infinite loops
  let iterationCount = 0;

  while (
    evaluateExpression(loopNode.test, context) &&
    iterationCount < maxIterations
  ) {
    console.log(`Loop iteration ${iterationCount}, condition: true`);

    // Execute loop body
    traverseAst(loopNode.body, context);
    // Capture context after loop body execution
    updateContextHistory(context);

    // Update loop variable
    console.log(`Updating loop variable for iteration ${iterationCount}`);
    traverseAst(loopNode.update, context);
    updateContextHistory(context);

    console.log(
      `Context after updating loop variable: ${JSON.stringify(
        context.variables
      )}`
    );

    iterationCount++;
  }

  if (iterationCount >= maxIterations) {
    console.log(
      "Maximum iteration count reached, exiting loop to prevent infinite loop"
    );
  }

  console.log("Loop ended");
}

function updateContextHistory(context) {
  console.log(`Context before update: ${JSON.stringify(context.variables)}`);
  context.history.push(JSON.parse(JSON.stringify(context.variables)));
  console.log(`Context after update: ${JSON.stringify(context.history)}`);
}

function swap(array, index1, index2) {
  let temp = array[index1];
  array[index1] = array[index2];
  array[index2] = temp;
}

function evaluateExpression(expression, context) {
  console.log(`Expression type: ${expression.type}`);
  if (expression.type === "AssignmentExpression") {
    console.log("Entered AssignmentExpression block");

    // Evaluate the right-hand side
    const value = evaluateExpression(expression.right, context);
    console.log(`Right-hand side value: ${value}`);

    // Handle assignment to an array element
    if (
      expression.left.type === "MemberExpression" &&
      expression.right.type === "MemberExpression"
    ) {
      console.log(`Potential swap operation detected`);

      const arrayNameLeft = expression.left.object.name;
      const indexLeft = evaluateExpression(expression.left.property, context);
      const arrayNameRight = expression.right.object.name;
      const indexRight = evaluateExpression(expression.right.property, context);

      console.log(`arrayNameLeft: ${arrayNameLeft}, indexLeft: ${indexLeft}`);
      console.log(
        `arrayNameRight: ${arrayNameRight}, indexRight: ${indexRight}`
      );

      if (
        context.variables.hasOwnProperty(arrayNameLeft) &&
        context.variables.hasOwnProperty(arrayNameRight)
      ) {
        console.log(`Both arrays found in context`);

        const arrayLeft = context.variables[arrayNameLeft];
        const arrayRight = context.variables[arrayNameRight];

        if (
          Array.isArray(arrayLeft) &&
          Array.isArray(arrayRight) &&
          indexLeft < arrayLeft.length &&
          indexRight < arrayRight.length
        ) {
          console.log(
            `Performing swap operation on arrays ${arrayNameLeft} and ${arrayNameRight}`
          );
          let temp = arrayLeft[indexLeft];
          arrayLeft[indexLeft] = arrayRight[indexRight];
          arrayRight[indexRight] = temp;

          // Update the entire arrays in the context history
          context.history.push({
            [arrayNameLeft]: [...arrayLeft],
            [arrayNameRight]: [...arrayRight],
          });
          return; // Return after performing the swap
        }
      }
    }
    // Handle assignment to a simple variable
    else if (expression.left.type === "Identifier") {
      console.log(`Simple variable assignment detected`);
      updateContext(expression.left.name, value, context);
      return value;
    }
  } else if (expression.type === "UpdateExpression") {
    console.log("Entered UpdateExpression block");

    const oldValue = evaluateExpression(expression.argument, context);
    console.log(`Old value of ${expression.argument.name}: ${oldValue}`);
    let newValue;

    // Handle increment and decrement
    if (expression.operator === "++") {
      newValue = oldValue + 1;
    } else if (expression.operator === "--") {
      newValue = oldValue - 1;
    }

    console.log(`New value of ${expression.argument.name}: ${newValue}`);

    // Update the variable in context
    if (expression.argument.type === "Identifier") {
      updateContext(expression.argument.name, newValue, context);
    }

    return newValue;
  } else if (expression.type === "MemberExpression") {
    const objectName = expression.object.name;

    if (expression.computed) {
      // Handle computed MemberExpression (array access)
      const indexExpression = expression.property;

      if (context.variables.hasOwnProperty(objectName)) {
        const array = context.variables[objectName];
        if (Array.isArray(array)) {
          const index = evaluateExpression(indexExpression, context);
          // Check if index is within bounds before accessing the array
          if (typeof index === "number" && index >= 0 && index < array.length) {
            return array[index];
          } else {
            console.log(`Index ${index} out of bounds for array ${arrayName}`);
            // Return null to indicate out-of-bounds access
            return null;
          }
        } else {
          console.log(`${objectName} is not an array.`);
        }
      } else {
        console.log(`Array ${objectName} not found in context.`);
      }
    } else if (expression.property.type === "Identifier") {
      const propertyName = expression.property.name;

      // Check if the object is an array and the property is 'length'
      if (context.variables.hasOwnProperty(objectName)) {
        console.log(`Found ${objectName} in context.`);
        const object = context.variables[objectName];
        console.log(
          `Object type: ${typeof object}, isArray: ${Array.isArray(object)}`
        );
        if (Array.isArray(object) && propertyName === "length") {
          console.log(`Array length found: ${object.length}`);
          return object.length;
        }
      } else {
        console.log(`Object ${objectName} not found in context.`);
      }
    }
  } else if (expression.type === "BinaryExpression") {
    console.log("Entered BinaryExpression block");
    const leftValue = evaluateExpression(expression.left, context);
    const rightValue = evaluateExpression(expression.right, context);

    // Check for out-of-bounds errors before evaluating the binary expression
    if (
      leftValue === "Error: Index out of bounds" ||
      rightValue === "Error: Index out of bounds"
    ) {
      console.log(`Error: One of the operands is out of bounds.`);
      return "Error";
    }

    switch (expression.operator) {
      case "+":
        return leftValue + rightValue;
      case "-":
        return leftValue - rightValue;
      case "<":
        return leftValue < rightValue;
      case ">":
        if (rightValue === "Unresolved") {
          console.log(
            `Error: Right-hand side of expression could not be resolved.`
          );
          return "Error";
        }
        return leftValue > rightValue;
      case "==":
        return leftValue == rightValue;
      // ... handle other operators ...
    }
  } else if (expression.type === "Literal") {
    return expression.value;
  } else if (expression.type === "Identifier") {
    if (context.variables.hasOwnProperty(expression.name)) {
      console.log(
        `Value of ${expression.name}: ${context.variables[expression.name]}`
      );
      return context.variables[expression.name];
    } else {
      console.log(`Identifier ${expression.name} not found in context.`);
      return "Unresolved";
    }
  } else if (
    expression.type === "BinaryExpression" &&
    expression.left.type === "Identifier" &&
    expression.left.name === "i" &&
    expression.right.type === "MemberExpression"
  ) {
    const leftValue = evaluateExpression(expression.left, context);
    const rightValue = evaluateExpression(expression.right, context);
    console.log(`Loop condition: ${leftValue} < ${rightValue}`);
    return leftValue < rightValue;
  } else if (expression.type === "LogicalExpression") {
    const left = evaluateExpression(expression.left, context);
    const right = evaluateExpression(expression.right, context);
    switch (expression.operator) {
      case "&&":
        return left && right;
      case "||":
        return left || right;
      // Add other operators as needed
    }
  }

  return "Unresolved";
}

function updateContext(variableName, newValue, context) {
  console.log(`Updating context for ${variableName}: ${newValue}`);
  context.variables[variableName] = newValue;

  // Record the new state of the context
  context.history.push({ [variableName]: newValue });
}

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
server.timeout = 300000;
