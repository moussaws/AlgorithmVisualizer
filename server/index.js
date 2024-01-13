const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const esprima = require("esprima");
const estraverse = require("estraverse");

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());
const fs = require('fs');
const util = require('util');
const logFile = fs.createWriteStream('log.txt', { flags: 'w' }); // 'log.txt' can be any file path
console.log = function () { // redefine console.log to call logFile.write with the same arguments
    logFile.write(util.format.apply(null, arguments) + '\n');
}

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
            console.log(`Entering node of type ${node.type}`);
            if (node.type === "VariableDeclaration") {
                handleVariableDeclaration(node, context);
            } else if (node.type === "ForStatement") {
                handleLoopNode(node, context);
            } else if (node.type === "IfStatement") {
                handleIfStatement(node, context);
            }
            // ... handle other node types ...
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
                updateContextHistory(context); // Add this line
            } else {
                // Handle other initializations
                const value = evaluateExpression(declaration.init, context);
                updateContext(declaration.id.name, value, context);
                updateContextHistory(context); // Add this line
            }
        }
    });
}
function evaluateExpression(expression, context) {
    switch (expression.type) {
        case "AssignmentExpression":
            return handleAssignmentExpression(expression, context);
        case "BinaryExpression":
            return handleBinaryExpression(expression, context);
        case "MemberExpression":
            return handleMemberExpression(expression, context);
        case "UpdateExpression":
            return handleUpdateExpression(expression, context);
        case "Literal":
            return handleLiteralExpression(expression, context);
        case "Identifier":
            return handleIdentifierExpression(expression, context);
        // ... handle other expression types ...
        default:
            throw new Error(`Unhandled expression type: ${expression.type}`);
    }
}
function handleLiteralExpression(expression, context) {
    // For Literal nodes, the value is directly available as expression.value
    return expression.value;
}

function handleIdentifierExpression(expression, context) {
    // For Identifier nodes, the value is the value of the variable in the context
    const variableName = expression.name;
    if (context.variables.hasOwnProperty(variableName)) {
        return context.variables[variableName];
    } else {
        throw new Error(`Undefined variable: ${variableName}`);
    }
}

function handleIfStatement(node, context) {
    const testResult = evaluateExpression(node.test, context);

    if (testResult) {
        if (node.consequent.type === "BlockStatement") {
            node.consequent.body.forEach((innerNode) => {
                if (innerNode.type === "ExpressionStatement") {
                    const expression = innerNode.expression;
                    if (expression.type === "AssignmentExpression") {
                        let arrayName = expression.left.object.name;
                        let leftIndex = evaluateExpression(expression.left.property, context);
                        let rightIndex;

                        if (expression.right.property) {
                            rightIndex = evaluateExpression(expression.right.property, context);
                        } else {
                            rightIndex = leftIndex + 1;
                        }

                        // Ensure the indices are within the array bounds
                        if (leftIndex >= 0 && leftIndex < context.variables[arrayName].length &&
                            rightIndex >= 0 && rightIndex < context.variables[arrayName].length) {
                            // Perform the swap operation
                            let temp = context.variables[arrayName][leftIndex];
                            context.variables[arrayName][leftIndex] = context.variables[arrayName][rightIndex];
                            context.variables[arrayName][rightIndex] = temp;

                            updateContext('array', context.variables[arrayName], context);
                            updateContextHistory(context);
                        } else {
                            // Handle out-of-bound indices
                            console.log(`Swap indices out of bounds: leftIndex = ${leftIndex}, rightIndex = ${rightIndex}`);
                        }
                    }
                }
            });
        }
    } else if (node.alternate) {
        traverseAst(node.alternate, context);
    }
}


function handleAssignmentExpression(expression, context) {
    console.log("Entered AssignmentExpression block");

    // Evaluate the right-hand side
    const value = evaluateExpression(expression.right, context);
    console.log(`Right-hand side value: ${value}`);

    // Handle assignment to an array element
    if (expression.left.type === "MemberExpression") {
        return handleArrayElementAssignment(expression, context, value);
    }
    // Handle assignment to a simple variable
    else if (expression.left.type === "Identifier") {
        console.log(`Simple variable assignment detected`);
        updateContext(expression.left.name, value, context, true);
        return value;
    }
    // Handle other types of expressions
    else {
        throw new Error(`Unhandled expression type: ${expression.left.type}`);
    }
}

function handleArrayElementAssignment(expression, context, value) {
    console.log(`Potential array element assignment detected`);

    const arrayName = expression.left.object.name;
    const index = evaluateExpression(expression.left.property, context);

    console.log(`arrayName: ${arrayName}, index: ${index}`);

    if (context.variables.hasOwnProperty(arrayName)) {
        console.log(`Array found in context`);

        const array = context.variables[arrayName];

        if (Array.isArray(array)) {
            if (index >= 0 && index < array.length) {
                console.log(`Performing assignment operation on array ${arrayName}`);
                array[index] = value;
                console.log(`Performed assignment operation on array ${arrayName} at index ${index}`);
            } else {
                console.log(`Index ${index} is out of bounds for array ${arrayName}`);
            }

            // Update the entire array in the context history
            context.history.push({
                [arrayName]: [...array],
            });
            return; // Return after performing the assignment
        }
    }
}

function handleBinaryExpression(expression, context) {
    console.log("Entered BinaryExpression block");

    const leftValue = evaluateExpression(expression.left, context);
    const rightValue = evaluateExpression(expression.right, context);

    switch (expression.operator) {
        case "+":
            return leftValue + rightValue;
        case "-":
            return leftValue - rightValue;
        case "<":
            return leftValue < rightValue;
        case ">":
            return leftValue > rightValue;
        // ... handle other operators ...
    }
}

function handleMemberExpression(expression, context) {
    console.log(`Entered MemberExpression block`);

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
                    console.log(`Index ${index} out of bounds for array ${objectName}`);
                    // Throw an error to indicate out-of-bounds access
                    throw new Error(`Index ${index} out of bounds for array ${objectName}`);
                }
            } else {
                console.log(`${objectName} is not an array.`);
                // Handle cases where the object is not an array
                throw new Error(`${objectName} is not an array`);
            }
        } else {
            console.log(`Array ${objectName} not found in context.`);
            // Handle cases where the array is not found in the context
            throw new Error(`Array ${objectName} not found in context`);
        }
    } else if (expression.property.type === "Identifier") {
        const propertyName = expression.property.name;

        // Check if the object is an array and the property is 'length'
        if (context.variables.hasOwnProperty(objectName)) {
            console.log(`Found ${objectName} in context.`);
            const object = context.variables[objectName];
            console.log(`Object type: ${typeof object}, isArray: ${Array.isArray(object)}`);
            if (Array.isArray(object) && propertyName === "length") {
                console.log(`Array length found: ${object.length}`);
                return object.length;
            }
        } else {
            console.log(`Object ${objectName} not found in context.`);
            // Handle cases where the object is not found in the context
            throw new Error(`Object ${objectName} not found in context`);
        }
    }
    // Handle other MemberExpression cases or throw an error
    throw new Error(`Unhandled MemberExpression type`);
}


function handleUpdateExpression(expression, context) {
    // For UpdateExpression nodes, the value is the updated value of the variable in the context
    const variableName = expression.argument.name;
    let newValue;
    if (expression.operator === "++") {
        newValue = context.variables[variableName] + 1;
    } else if (expression.operator === "--") {
        newValue = context.variables[variableName] - 1;
    }
    updateContext(variableName, newValue, context, true);}



function handleLoopNode(node, context) {
    console.log("Handling ForStatement");

    // Initialize loop variable
    console.log("Initializing loop variable");
    if (node.init.type === "VariableDeclaration") {
        handleVariableDeclaration(node.init, context);
    } else if (node.init.type === "AssignmentExpression") {
        handleAssignmentExpression(node.init, context);
    }
    updateContextHistory(context);

    const maxIterations = 1000; // Set a maximum iteration count to prevent infinite loops
    let iterationCount = 0;

    while (
        evaluateExpression(node.test, context) &&
        iterationCount < maxIterations
    ) {
        console.log(`Loop iteration ${iterationCount}, condition: true`);

        // Execute loop body
        if (node.body.type === "BlockStatement") {
            node.body.body.forEach(innerNode => {
                traverseAst(innerNode, context); // Pass the current context to the inner loop
            });
        } else {
            traverseAst(node.body, context); // Pass the current context to the inner loop
        }
        // Capture context after loop body execution
        updateContextHistory(context);

        // Update loop variable
        console.log(`Updating loop variable for iteration ${iterationCount}`);
        if (node.update.type === "UpdateExpression") {
            handleUpdateExpression(node.update, context);
        }
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
    // Get the last entry in the history
    const lastEntry = context.history[context.history.length - 1];

    // Only push the current context to the history if it's different from the last entry
    if (!lastEntry || 
        lastEntry.array.toString() !== context.variables.array.toString() ||
        lastEntry.i !== context.variables.i ||
        lastEntry.j !== context.variables.j ||
        lastEntry.temp !== context.variables.temp) {
        context.history.push(JSON.parse(JSON.stringify(context.variables)));
    }
}

function updateContext(name, value, context, updateHistory = false) {
    // Check if the value has changed before updating
    if (context.variables[name] !== value) {
        context.variables[name] = value;
        if (updateHistory) {
            updateContextHistory(context);
        }
    }
}

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
server.timeout = 300000;